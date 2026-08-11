# Login/Logout Activity Logging — Design

## Problem

The activity log shipped in `2026-08-11-super-admin-user-actions-and-audit-log-design.md` only captures three admin-initiated actions on other accounts (activate/deactivate/remove). The user wants it to also capture login and logout — both successful and failed — across every role that authenticates: staff (lecturer/school-admin/super-admin, via password) and students (via credential-less matric-number + access-code/date-of-birth flows).

The prior design's migration (`20260811130000_admin_user_actions_and_log.sql`) has already been applied, so this is a follow-up migration, not an amendment.

## Goal

Every successful and failed authentication attempt, across all roles, is captured in the same `admin_action_log` table the existing UI already reads, without adding new queries to the login hot path (a brute-force-sensitive path) and without opening up RLS in a way that weakens who can write to or read the log.

## Design

### 1. Schema (new migration)

```sql
ALTER TABLE admin_action_log DROP CONSTRAINT admin_action_log_action_check;
ALTER TABLE admin_action_log ADD CONSTRAINT admin_action_log_action_check
  CHECK (action IN ('activated', 'deactivated', 'removed', 'logged_in', 'logged_out', 'login_failed'));

ALTER TABLE admin_action_log ADD COLUMN IF NOT EXISTS subject_role user_role;
ALTER TABLE admin_action_log ADD COLUMN IF NOT EXISTS target_identifier TEXT;
```

- `subject_role` (reusing the existing `user_role` enum): lets the UI's staff/student filter (§3) work even on a `login_failed` row where no real account was ever resolved — the calling code always knows *which kind* of login was attempted (a password-login form vs. a student matric+code form), even when it doesn't know *whose*.
- `target_identifier`: the raw typed email or matric number, populated only when `target_user_id` can't be resolved to a real account. Never used to distinguish "this email doesn't exist" from "this email exists but the password was wrong" in what's stored — see §2, this is deliberate.

### 2. Where each event is logged

All new log inserts here use `createAdminClient()` (service-role, bypasses RLS) — the same pattern `superAdminRemoveUser` already uses for its own insert. This is deliberate: a failed login attempt has no authenticated session to write under (`auth.uid()` is NULL), and a lecturer's own successful login needs to log a row about themselves, which no existing RLS insert policy covers. Rather than design and audit a new set of insert policies for "anonymous failed attempts" and "any authenticated role logging about themselves" — a meaningfully larger RLS surface to get right on a security-relevant table — every write here goes through the same trusted server-side path the app already trusts for admin actions. The existing `super_admin_insert_action_log` / `school_admin_insert_own_action_log` policies are untouched and still govern only the original three admin-action inserts.

- **`lib/actions/auth.js` `signIn`**: on success, the existing post-login `select('role')` (line 39) widens to `select('role, university_id')` — no new query — and a log row is inserted (`action: 'logged_in'`, `target_user_id: data.user.id`, `actor_id: data.user.id`, `subject_role: profile.role`, `university_id: profile.university_id`) before `redirect(home)`. On failure, a row is inserted (`action: 'login_failed'`, `target_identifier: parsed.data.email`, `subject_role: null`, all other identity fields null) before returning the existing error object — deliberately no lookup of whether that email belongs to a real account, so this logging can never become a new way to detect account existence (the user-visible error message is already carefully generic here, per the existing comment at auth.js:29-31).
- **`lib/actions/auth.js` `signOut`**: call `supabase.auth.getUser()` before `supabase.auth.signOut()` (the session is gone after), then look up `role, university_id` from `users` by that id, insert `action: 'logged_out'`, then proceed with the existing sign-out + redirect. This is a new query, but logout is not brute-force-sensitive, unlike login.
- **`lib/actions/studentAuth.js` `verifyExamAccess`**: success (right before `redirect`) → `action: 'logged_in', target_user_id: student.id, actor_id: student.id, subject_role: 'student', university_id: exam.university_id` (both already in scope, no new query). Failure has two branches: `!exam` and `!student || !student.is_active`. Only the second branch can have a resolved identity — split it: `student` truthy but inactive → `target_user_id: student.id, university_id: exam.university_id, target_identifier: null`; the `!exam` branch and the `!student` sub-case both use `target_identifier: matric_number` with all id fields null. `subject_role: 'student'` on every branch (the attempt is always a student attempt, resolved or not).
- **`lib/actions/studentAuth.js` `verifyResultAccess`**: same shape — success uses `students[0].id`; failure uses `students[0].id` only when `students.length === 1` (found but inactive), else `target_identifier: matric_number`.
- **`lib/actions/studentAuth.js` `endStudentSession`**: same pattern as staff `signOut` — `getUser()` before `signOut()`, look up `university_id` (role is always `'student'` here, no need to look it up), insert `logged_out`.
- **`mintStudentSession`'s internal `signOut()`** (`lib/supabase/studentSession.js:51`, kiosk session-bleed hygiene): explicitly NOT logged — it is not a user-initiated logout, logging it would misrepresent kiosk hygiene as the student's own action.
- **`proxy.js`'s per-request `updateSession()` token refresh**: explicitly NOT logged — it fires on nearly every request for every already-authenticated user; logging it would spam the table by orders of magnitude and drown out every real event.
- Every new log-insert call is wrapped the same way the existing three actions already wrap theirs: a failure logs via `console.error` and never blocks or changes the user-facing auth result.

### 3. UI: staff/student filter

Both `app/super-admin/logs/page.js` and `app/admin/logs/page.js` gain a simple `?role=` query-param-driven filter (a plain `<select>` inside a `<form>` using GET, no client-side state needed — matches this app's preference for server-rendered simplicity elsewhere) with options "All," "Staff," "Students." "Staff" maps to `subject_role IN ('lecturer', 'school_admin', 'super_admin')`; "Students" maps to `subject_role = 'student'`. Default: "All" is fine as the initial view — the existing three admin-action rows (`activated`/`deactivated`/`removed`) have `subject_role` null under this design (they're not login events), so an "All" default still shows them alongside login activity; a future concern, not this pass's.

Action label/color maps (`ACTION_LABELS`/`ACTION_COLORS`) in both pages gain the three new keys: `logged_in` (success-colored), `logged_out` (neutral), `login_failed` (danger-colored).

## Non-goals

- No rate-limiting or brute-force-detection changes — `verification_attempts` keeps doing that job untouched; this log is a read surface for humans, not a security control.
- No lookup-on-failure enrichment for staff logins (resolving whether a failed email belongs to a real account) — deliberately excluded, see §2.
- No distinction between "exam access" vs. "result lookup" student login types in the log — both just log as `logged_in`/`login_failed` with `subject_role: 'student'`.
- No change to who can *view* the log (still super-admin platform-wide, school-admin own-university-only) — only what gets written into it changes.
