# Super-Admin User Actions + Audit Log — Design

## Problem

A super-admin reported being unable to: (a) revoke a user's access, (b) remove/delete a user, or (c) view any activity/audit log, from the super-admin dashboard.

Investigation found a mix of causes:
- **Revoke access**: the backend already exists and works (`superAdminToggleUserActive` in `lib/actions/admin.js:314`) — it's just never wired to any button on `app/super-admin/users/page.js`, which today is a pure read-only table. The equivalent already works correctly on the school-admin dashboard (`toggleUserActive` + `ToggleActiveButton.js`).
- **Remove/delete user**: doesn't exist at all, front or back end.
- **Audit/activity logs**: doesn't exist at all — no log table in the schema, no capture mechanism, no UI.

## Goal

A super-admin can activate/deactivate any user (matching the existing school-admin capability), can permanently remove a user from active use (without destroying their data or breaking referential integrity elsewhere), and can see a log of who did what to which account. A school-admin sees the same kind of log, scoped to their own university.

## Design

### 1. Data model

One migration, `supabase/migrations/<timestamp>_admin_user_actions_and_log.sql`:

- `ALTER TABLE users ADD COLUMN removed_at TIMESTAMPTZ` (nullable). Set alongside `is_active = false` when a super-admin removes a user. This is deliberately the *only* new signal needed: every existing `is_active = true` filter in the app (student search for exam access, lecturer/student counts on dashboards, login gating in `lib/dal.js:26`) already excludes a removed user automatically, since removal always implies `is_active = false`. No other query in the codebase needs to change.
- New table `admin_action_log`:
  ```sql
  CREATE TABLE IF NOT EXISTS admin_action_log (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    university_id  UUID REFERENCES universities(id) ON DELETE SET NULL,
    actor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    action         TEXT NOT NULL CHECK (action IN ('activated', 'deactivated', 'removed')),
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```
  `university_id` is the *target* user's university at the time of the action (not the actor's) — this is what lets a school-admin's log view (§3) show "actions on users at my university" regardless of whether a super-admin or that university's own school-admin performed the action. Names are not denormalized onto this table: the log view joins live `users`/`universities` data at read time, the same embed pattern the users pages already use (e.g. `universities ( name )` in `app/super-admin/users/page.js:29`), since nothing in this app renames a user or hard-deletes one — `ON DELETE SET NULL` on both FKs is purely defensive, for the case of a user row removed by direct database access outside the app (never triggered by any app code path).
- RLS on `admin_action_log`:
  ```sql
  CREATE POLICY "super_admin_read_action_log" ON admin_action_log
    FOR SELECT USING (auth_role() = 'super_admin');

  CREATE POLICY "super_admin_insert_action_log" ON admin_action_log
    FOR INSERT WITH CHECK (auth_role() = 'super_admin');

  CREATE POLICY "school_admin_read_own_action_log" ON admin_action_log
    FOR SELECT USING (auth_role() = 'school_admin' AND university_id = auth_university_id());

  CREATE POLICY "school_admin_insert_own_action_log" ON admin_action_log
    FOR INSERT WITH CHECK (auth_role() = 'school_admin' AND university_id = auth_university_id() AND actor_id = auth.uid());
  ```
  The super-admin INSERT policy is defensive symmetry, not load-bearing: `superAdminToggleUserActive`/`superAdminRemoveUser` write through `createAdminClient()` (service-role, bypasses RLS, same as their existing user-table writes), while `toggleUserActive` (school-admin) writes through the ordinary session-bound client, so its INSERT policy is the one actually enforced.

### 2. Server actions (`lib/actions/admin.js`)

- **`toggleUserActive`** (school-admin, existing, `lib/actions/admin.js:172-196`) and **`superAdminToggleUserActive`** (super-admin, existing, `lib/actions/admin.js:314-334`) both gain, after a successful update:
  - A guard at the top, right after fetching `target`: if `target.removed_at` is set, return `{ error: 'This user has been removed and cannot be reactivated.' }` before touching `is_active` — removal must stay one-way even if someone calls the old toggle directly.
  - An insert into `admin_action_log` (`action: 'activated'` or `'deactivated'` based on the new state, `university_id: target.university_id`, `actor_id: user.id`, `target_user_id: userId`) right before the existing `revalidatePath` call. A log-insert failure should not fail the whole action (the user-facing state change already succeeded) — wrap it so an error there is `console.error`'d, not returned to the caller, matching this file's existing `console.error('[...]', ...)` pattern for non-fatal failures elsewhere in the codebase (e.g. `addQuestionToExam`'s insert-error branch).
  - `superAdminToggleUserActive` additionally gains the self-protection check `toggleUserActive` already has: `if (target.id === user.id) return { error: 'You cannot deactivate your own account.' }` — this was a pre-existing gap (a super-admin could lock themselves out), fixed here since this task is already touching this exact function.
- **New `superAdminRemoveUser(userId)`**, added after `superAdminToggleUserActive`:
  - `requireRole('super_admin')`, fetch target via `createAdminClient()`, reject if not found, reject if already removed (`{ error: 'This user has already been removed.' }`), reject self-removal (`{ error: 'You cannot remove your own account.' }`).
  - Update: `is_active: false, removed_at: new Date().toISOString()`.
  - Insert `admin_action_log` row (`action: 'removed'`), same non-fatal-on-log-failure handling as above.
  - `revalidatePath('/super-admin/users')`, return `{ ok: true }`.

### 3. UI

- **`app/super-admin/users/page.js`**: add an Actions column. For each row: if `removed_at` is set, a static "Removed" badge, no buttons. Otherwise, an Activate/Deactivate button (new client component `SuperAdminUserActions.js`, same `useTransition` + toast pattern as `app/admin/users/ToggleActiveButton.js`) plus a "Remove" button that opens a confirmation (type the user's name to confirm, given the action is one-way) before calling `superAdminRemoveUser`. The currently-logged-in super-admin's own row shows neither button — just their badge, matching the self-protection already enforced server-side.
- **`app/super-admin/logs/page.js`** (new): read-only table — timestamp, actor name (joined), action, target user name + university (joined). Same query/pagination shape as the existing users page (`.order('created_at', { ascending: false }).limit(200)`).
- **`app/admin/logs/page.js`** (new): same table shape, scoped to the school-admin's own university via RLS (no extra `.eq()` needed in the query — same pattern as relying on RLS alone established in the question-bank scoping work).
- **`components/shared/Sidebar.js`**: add a "Logs" nav entry to both the `super_admin` and `school_admin` arrays. The file currently has an unrelated, uncommitted "Universities" entry already added to the `super_admin` array by other in-progress work — this change is additive on top of the file's current working-tree content, not the last-committed version, and does not touch that entry.

## Non-goals

- No "remove" capability for school-admins — only super-admin, matching what was actually reported broken. School-admins keep only activate/deactivate.
- No restore-from-removed UI anywhere, ever, in this design — removal is one-way through the app. (The data itself is never destroyed; a direct database edit remains possible outside the app if ever truly needed.)
- No denormalized actor/target name snapshots on the log table — reads join live user data, per §1.
- No generic/extensible audit-log system for other action types (exam changes, question edits, etc.) — scoped strictly to the three user-account actions this design adds logging for.
