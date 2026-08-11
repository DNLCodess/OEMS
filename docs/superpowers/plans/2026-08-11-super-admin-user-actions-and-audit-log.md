# Super-Admin User Actions + Audit Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A super-admin can activate/deactivate any user, permanently remove a user (one-way, data preserved), and view a platform-wide activity log; a school-admin sees the same kind of log scoped to their own university.

**Architecture:** A new nullable `users.removed_at` column plus a new `admin_action_log` table (RLS-scoped by the target user's university) are the data layer. Three server actions in `lib/actions/admin.js` — two existing (`toggleUserActive`, `superAdminToggleUserActive`) gain a removed-user guard and a log-insert; one new (`superAdminRemoveUser`) — are the write path. Two new read-only log pages plus a wired-up Actions column on the existing super-admin users page are the UI.

**Tech Stack:** Supabase/PostgreSQL (RLS, manually-applied migrations), Next.js server actions, React (`useTransition`, client components), vitest + `tests/helpers/supabaseMock.js`.

## Global Constraints

- Migrations are written as SQL files under `supabase/migrations/` and applied manually via the Supabase Dashboard SQL editor — no automated runner. Follow `supabase/migrations/README.md`'s naming (`YYYYMMDDHHMMSS_short_description.sql`) and one-logical-change-per-file convention.
- `removed_at` is the only new "is this user removed" signal. No other query anywhere in the app needs to change — every existing `is_active = true` filter already excludes a removed user, since removal always sets `is_active = false` too.
- Removal is one-way through the app: no "restore" UI anywhere in this plan.
- No "remove" capability for school-admins — only super-admin. School-admins keep activate/deactivate only.
- Log table reads join live `users`/`universities` data — no denormalized name columns.
- A log-insert failure must never fail the parent action (the user-facing state change already succeeded); log it via `console.error`, matching this file's existing non-fatal-error pattern.

---

### Task 1: Migration — `removed_at` column + `admin_action_log` table

**Files:**
- Create: `supabase/migrations/20260811130000_admin_user_actions_and_log.sql`

**Interfaces:**
- Produces: `users.removed_at` column; `admin_action_log` table with columns `id, university_id, actor_id, action, target_user_id, created_at`; RLS policies consumed by Task 2's server actions and Task 4's log pages.

No automated test harness exists for RLS/schema migrations in this repo (consistent with every other file under `supabase/migrations/`) — verified manually per Step 2 below.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260811130000_admin_user_actions_and_log.sql`:

```sql
-- Adds the ability to permanently (one-way, through the app) remove a user,
-- and a scoped activity log for user activate/deactivate/remove actions.
-- removed_at is the only new "is removed" signal — it's always set together
-- with is_active = false, so every existing is_active = true filter in the
-- app already excludes a removed user with no other code changes needed.
-- Applied: <fill in the date you run this>

ALTER TABLE users ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS admin_action_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  university_id  UUID REFERENCES universities(id) ON DELETE SET NULL,
  actor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL CHECK (action IN ('activated', 'deactivated', 'removed')),
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admin_action_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_read_action_log" ON admin_action_log
  FOR SELECT TO authenticated
  USING (auth_role() = 'super_admin');

CREATE POLICY "super_admin_insert_action_log" ON admin_action_log
  FOR INSERT TO authenticated
  WITH CHECK (auth_role() = 'super_admin');

CREATE POLICY "school_admin_read_own_action_log" ON admin_action_log
  FOR SELECT TO authenticated
  USING (auth_role() = 'school_admin' AND university_id = auth_university_id());

CREATE POLICY "school_admin_insert_own_action_log" ON admin_action_log
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_role() = 'school_admin'
    AND university_id = auth_university_id()
    AND actor_id = auth.uid()
  );

CREATE INDEX IF NOT EXISTS idx_admin_action_log_university ON admin_action_log(university_id);
CREATE INDEX IF NOT EXISTS idx_admin_action_log_created_at ON admin_action_log(created_at DESC);
```

- [ ] **Step 2: Document the manual verification**

Append to the same migration file (continuing from Step 1):

```sql

-- Manual verification (run via the app as each role, or via SET ROLE /
-- impersonation in the SQL editor — never as the postgres/service-role
-- user, which bypasses RLS entirely):
--
--   SELECT * FROM admin_action_log ORDER BY created_at DESC LIMIT 20;
--
-- Expected: a super_admin sees every row; a school_admin sees only rows
-- where university_id matches their own university.
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260811130000_admin_user_actions_and_log.sql
git commit -m "feat: add removed_at column and admin_action_log table"
```

---

### Task 2: Server actions — guards, logging, and `superAdminRemoveUser`

**Files:**
- Modify: `lib/actions/admin.js`
- Test: `lib/actions/admin.test.js`

**Interfaces:**
- Modifies: `toggleUserActive(userId)` — same signature/return shape (`{ error }` or `{ ok: true, is_active }`), gains a removed-user rejection.
- Modifies: `superAdminToggleUserActive(userId)` — same signature/return shape, gains a self-protection check, a removed-user rejection, and a log-insert.
- Produces: `superAdminRemoveUser(userId): Promise<{ error: string } | { ok: true }>`, consumed by Task 3's `SuperAdminUserActions.js`.

- [ ] **Step 1: Write the failing tests**

First, read the current top of `lib/actions/admin.test.js` to see its existing imports and `schoolAdmin` constant — add to the import line and add new `describe` blocks after the file's existing content (don't duplicate the `formData` helper or `beforeEach`).

Add `superAdminToggleUserActive` and `superAdminRemoveUser` to the existing import line (change):

```js
import { inviteUser, bulkUploadStudents } from './admin'
```

to:

```js
import { inviteUser, bulkUploadStudents, toggleUserActive, superAdminToggleUserActive, superAdminRemoveUser } from './admin'
```

Then append these `describe` blocks at the end of the file (after the existing `describe('bulkUploadStudents', ...)` block's closing `})`):

```js
describe('toggleUserActive', () => {
  it('rejects reactivating a removed user', async () => {
    const supabase = createMockSupabaseClient({
      users: [{ data: { id: 'user-2', is_active: false, removed_at: '2026-08-01T00:00:00Z', university_id: 'uni-1' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await toggleUserActive('user-2')

    expect(result).toEqual({ error: 'This user has been removed and cannot be reactivated.' })
  })

  it('toggles and logs the action on success', async () => {
    const supabase = createMockSupabaseClient({
      users: [
        { data: { id: 'user-2', is_active: true, removed_at: null, university_id: 'uni-1' }, error: null },
        { data: null, error: null }, // update
      ],
      admin_action_log: [{ data: null, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await toggleUserActive('user-2')

    expect(result).toEqual({ ok: true, is_active: false })
    expect(supabase.from).toHaveBeenCalledWith('admin_action_log')
  })
})

describe('superAdminToggleUserActive', () => {
  const superAdmin = { id: 'super-1', role: 'super_admin' }

  it('returns an error when the target user is not found', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const adminClient = createMockSupabaseClient({ users: [{ data: null, error: null }] })
    createAdminClient.mockReturnValue(adminClient)

    const result = await superAdminToggleUserActive('user-2')

    expect(result).toEqual({ error: 'User not found.' })
  })

  it('rejects toggling your own account', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const adminClient = createMockSupabaseClient({
      users: [{ data: { id: 'super-1', is_active: true, removed_at: null, university_id: null }, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await superAdminToggleUserActive('super-1')

    expect(result).toEqual({ error: 'You cannot deactivate your own account.' })
  })

  it('rejects reactivating a removed user', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const adminClient = createMockSupabaseClient({
      users: [{ data: { id: 'user-2', is_active: false, removed_at: '2026-08-01T00:00:00Z', university_id: 'uni-1' }, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await superAdminToggleUserActive('user-2')

    expect(result).toEqual({ error: 'This user has been removed and cannot be reactivated.' })
  })

  it('toggles and logs the action on success', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const adminClient = createMockSupabaseClient({
      users: [
        { data: { id: 'user-2', is_active: true, removed_at: null, university_id: 'uni-1' }, error: null },
        { data: null, error: null }, // update
      ],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await superAdminToggleUserActive('user-2')

    expect(result).toEqual({ ok: true, is_active: false })
    expect(adminClient.from).toHaveBeenCalledWith('admin_action_log')
  })
})

describe('superAdminRemoveUser', () => {
  const superAdmin = { id: 'super-1', role: 'super_admin' }

  it('returns an error when the target user is not found', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const adminClient = createMockSupabaseClient({ users: [{ data: null, error: null }] })
    createAdminClient.mockReturnValue(adminClient)

    const result = await superAdminRemoveUser('user-2')

    expect(result).toEqual({ error: 'User not found.' })
  })

  it('rejects removing your own account', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const adminClient = createMockSupabaseClient({
      users: [{ data: { id: 'super-1', removed_at: null, university_id: null }, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await superAdminRemoveUser('super-1')

    expect(result).toEqual({ error: 'You cannot remove your own account.' })
  })

  it('rejects removing an already-removed user', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const adminClient = createMockSupabaseClient({
      users: [{ data: { id: 'user-2', removed_at: '2026-08-01T00:00:00Z', university_id: 'uni-1' }, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await superAdminRemoveUser('user-2')

    expect(result).toEqual({ error: 'This user has already been removed.' })
  })

  it('removes the user and logs the action on success', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const adminClient = createMockSupabaseClient({
      users: [
        { data: { id: 'user-2', removed_at: null, university_id: 'uni-1' }, error: null },
        { data: null, error: null }, // update
      ],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await superAdminRemoveUser('user-2')

    expect(result).toEqual({ ok: true })
    expect(adminClient.from).toHaveBeenCalledWith('admin_action_log')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/actions/admin.test.js`
Expected: FAIL — `toggleUserActive`, `superAdminToggleUserActive` are not yet exported/imported correctly for the new assertions (the two functions exist today but without the removed-guard/logging behavior these tests check), and `superAdminRemoveUser` fails with "is not a function" (doesn't exist yet).

- [ ] **Step 3: Implement**

In `lib/actions/admin.js`, replace the existing `toggleUserActive` function (currently `lib/actions/admin.js:172-196`) with:

```js
export async function toggleUserActive(userId) {
  const user = await requireRole('school_admin', 'super_admin')
  const supabase = await createClient()

  // Fetch current state (also verifies university scope)
  const { data: target } = await supabase
    .from('users')
    .select('id, is_active, removed_at, university_id')
    .eq('id', userId)
    .eq('university_id', user.university_id)
    .single()

  if (!target) return { error: 'User not found.' }
  if (target.id === user.id) return { error: 'You cannot deactivate your own account.' }
  if (target.removed_at) return { error: 'This user has been removed and cannot be reactivated.' }

  const nextActive = !target.is_active

  const { error } = await supabase
    .from('users')
    .update({ is_active: nextActive })
    .eq('id', userId)

  if (error) return { error: error.message }

  const { error: logError } = await supabase
    .from('admin_action_log')
    .insert({
      university_id:  target.university_id,
      actor_id:       user.id,
      action:         nextActive ? 'activated' : 'deactivated',
      target_user_id: userId,
    })
  if (logError) console.error('[toggleUserActive] log insert failed', logError.message)

  revalidatePath('/admin/users')
  return { ok: true, is_active: nextActive }
}
```

Replace the existing `superAdminToggleUserActive` function (currently `lib/actions/admin.js:314-334`) with:

```js
export async function superAdminToggleUserActive(userId) {
  const user = await requireRole('super_admin')
  const adminClient = createAdminClient()

  const { data: target } = await adminClient
    .from('users')
    .select('id, is_active, removed_at, university_id')
    .eq('id', userId)
    .single()

  if (!target) return { error: 'User not found.' }
  if (target.id === user.id) return { error: 'You cannot deactivate your own account.' }
  if (target.removed_at) return { error: 'This user has been removed and cannot be reactivated.' }

  const nextActive = !target.is_active

  const { error } = await adminClient
    .from('users')
    .update({ is_active: nextActive })
    .eq('id', userId)

  if (error) return { error: error.message }

  const { error: logError } = await adminClient
    .from('admin_action_log')
    .insert({
      university_id:  target.university_id,
      actor_id:       user.id,
      action:         nextActive ? 'activated' : 'deactivated',
      target_user_id: userId,
    })
  if (logError) console.error('[superAdminToggleUserActive] log insert failed', logError.message)

  revalidatePath('/super-admin/users')
  return { ok: true, is_active: nextActive }
}
```

Add `superAdminRemoveUser`, immediately after `superAdminToggleUserActive`:

```js
export async function superAdminRemoveUser(userId) {
  const user = await requireRole('super_admin')
  const adminClient = createAdminClient()

  const { data: target } = await adminClient
    .from('users')
    .select('id, removed_at, university_id')
    .eq('id', userId)
    .single()

  if (!target) return { error: 'User not found.' }
  if (target.id === user.id) return { error: 'You cannot remove your own account.' }
  if (target.removed_at) return { error: 'This user has already been removed.' }

  const { error } = await adminClient
    .from('users')
    .update({ is_active: false, removed_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) return { error: error.message }

  const { error: logError } = await adminClient
    .from('admin_action_log')
    .insert({
      university_id:  target.university_id,
      actor_id:       user.id,
      action:         'removed',
      target_user_id: userId,
    })
  if (logError) console.error('[superAdminRemoveUser] log insert failed', logError.message)

  revalidatePath('/super-admin/users')
  return { ok: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/actions/admin.test.js`
Expected: PASS, all tests including the new ones.

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/admin.js lib/actions/admin.test.js
git commit -m "feat: guard removed users and log activate/deactivate/remove actions"
```

---

### Task 3: Wire up the super-admin users page

**Files:**
- Modify: `app/super-admin/users/page.js`
- Create: `app/super-admin/users/SuperAdminUserActions.js`

**Interfaces:**
- Consumes: `superAdminToggleUserActive`, `superAdminRemoveUser` (Task 2).
- `SuperAdminUserActions({ userId, userName, isActive }): JSX.Element` — client component, named export.

- [ ] **Step 1: Create the actions component**

Create `app/super-admin/users/SuperAdminUserActions.js`:

```jsx
'use client'

import { useState, useTransition } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { superAdminToggleUserActive, superAdminRemoveUser } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

export function SuperAdminUserActions({ userId, userName, isActive }) {
  const [pending, startTransition] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  function handleToggle() {
    startTransition(async () => {
      const result = await superAdminToggleUserActive(userId)
      if (result?.error) toast.error(result.error)
      else toast.success(result.is_active ? 'User activated.' : 'User deactivated.')
    })
  }

  function handleRemove() {
    startTransition(async () => {
      const result = await superAdminRemoveUser(userId)
      if (result?.error) toast.error(result.error)
      else {
        toast.success('User removed.')
        setConfirmOpen(false)
      }
    })
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={handleToggle}
        disabled={pending}
        className={[
          'text-xs font-medium px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50',
          isActive ? 'text-danger hover:bg-danger-light' : 'text-success hover:bg-success-light',
        ].join(' ')}
      >
        {pending ? '…' : isActive ? 'Deactivate' : 'Activate'}
      </button>
      <button
        onClick={() => setConfirmOpen(true)}
        disabled={pending}
        className="text-xs font-medium px-2.5 py-1 rounded-lg text-danger hover:bg-danger-light transition-colors disabled:opacity-50"
      >
        Remove
      </button>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-text-primary">Remove {userName}</h2>
              <button
                onClick={() => setConfirmOpen(false)}
                className="p-1.5 rounded text-text-muted hover:text-text-primary"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-text-secondary mb-4">
              This permanently removes {userName}&rsquo;s access. This cannot be undone from the app. Type their name to confirm.
            </p>
            <Input
              id="confirm-name"
              label={`Type "${userName}" to confirm`}
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={userName}
            />
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleRemove}
                loading={pending}
                disabled={confirmText !== userName}
              >
                Remove user
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the users page**

Replace the full contents of `app/super-admin/users/page.js` with:

```jsx
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { Users } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { SuperAdminUserActions } from './SuperAdminUserActions'

export const metadata = { title: 'All Users — OEMS' }

const ROLE_LABELS = {
  super_admin:  'Platform Admin',
  school_admin: 'Exam Officer',
  lecturer:     'Lecturer',
  student:      'Student',
}

const ROLE_COLORS = {
  super_admin:  'bg-purple-100 text-purple-700',
  school_admin: 'bg-primary-light text-primary',
  lecturer:     'bg-warning-light text-warning',
  student:      'bg-success-light text-success',
}

export default async function SuperAdminUsersPage() {
  const user     = await requireRole('super_admin')
  const supabase = await createClient()

  const { data: users } = await supabase
    .from('users')
    .select('id, full_name, email, role, matric_number, is_active, removed_at, created_at, universities ( name )')
    .neq('id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <>
      <TopBar
        title="All Users"
        subtitle={`${users?.length ?? 0} users across the platform`}
      />
      <main className="flex-1 p-6">
        {!users?.length ? (
          <EmptyState icon={Users} title="No users yet" description="Users appear here once universities are set up." />
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-page">
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Name</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden sm:table-cell">Email</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Role</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden md:table-cell">University</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map(u => (
                  <tr key={u.id} className={u.is_active ? 'hover:bg-slate-50' : 'opacity-60 hover:bg-slate-50'}>
                    <td className="px-4 py-3 font-medium text-text-primary">
                      {u.full_name}
                      {u.matric_number && (
                        <span className="block font-mono text-xs text-text-muted">{u.matric_number}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-secondary hidden sm:table-cell">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[u.role] ?? 'bg-slate-100 text-slate-600'}`}>
                        {ROLE_LABELS[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs hidden md:table-cell">
                      {u.universities?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {u.removed_at ? (
                        <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-danger-light text-danger">
                          Removed
                        </span>
                      ) : (
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                          u.is_active ? 'bg-success-light text-success' : 'bg-slate-100 text-text-muted'
                        }`}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!u.removed_at && (
                        <SuperAdminUserActions userId={u.id} userName={u.full_name} isActive={u.is_active} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  )
}
```

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (no test file targets this page directly — server component pages aren't unit-tested elsewhere in this repo; this step confirms the change didn't break any action-level tests it depends on).

- [ ] **Step 4: Commit**

```bash
git add app/super-admin/users/page.js app/super-admin/users/SuperAdminUserActions.js
git commit -m "feat: wire revoke-access and remove-user actions into super-admin users page"
```

---

### Task 4: Activity log pages + navigation

**Files:**
- Create: `app/super-admin/logs/page.js`
- Create: `app/admin/logs/page.js`
- Modify: `components/shared/Sidebar.js`

**Interfaces:**
- No new exports consumed elsewhere — these are leaf pages.

- [ ] **Step 1: Create the super-admin log page**

Create `app/super-admin/logs/page.js`:

```jsx
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { History } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata = { title: 'Activity Log — OEMS' }

const ACTION_LABELS = {
  activated:   'Activated',
  deactivated: 'Deactivated',
  removed:     'Removed',
}

const ACTION_COLORS = {
  activated:   'bg-success-light text-success',
  deactivated: 'bg-slate-100 text-text-muted',
  removed:     'bg-danger-light text-danger',
}

export default async function SuperAdminLogsPage() {
  await requireRole('super_admin')
  const supabase = await createClient()

  const { data: logs } = await supabase
    .from('admin_action_log')
    .select(`
      id, action, created_at,
      actor:actor_id ( full_name ),
      target:target_user_id ( full_name ),
      universities:university_id ( name )
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <>
      <TopBar title="Activity Log" subtitle="Account actions across the platform" />
      <main className="flex-1 p-6">
        {!logs?.length ? (
          <EmptyState icon={History} title="No activity yet" description="Account actions (activate, deactivate, remove) will appear here." />
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-page">
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">When</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Actor</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Action</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Target</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden md:table-cell">University</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map(log => (
                  <tr key={log.id}>
                    <td className="px-4 py-3 text-text-muted text-xs whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{log.actor?.full_name ?? 'Unknown'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${ACTION_COLORS[log.action] ?? 'bg-slate-100 text-slate-600'}`}>
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-text-primary">{log.target?.full_name ?? 'Unknown'}</td>
                    <td className="px-4 py-3 text-text-muted text-xs hidden md:table-cell">
                      {log.universities?.name ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  )
}
```

- [ ] **Step 2: Create the school-admin log page**

Create `app/admin/logs/page.js`:

```jsx
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { History } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata = { title: 'Activity Log — OEMS' }

const ACTION_LABELS = {
  activated:   'Activated',
  deactivated: 'Deactivated',
  removed:     'Removed',
}

const ACTION_COLORS = {
  activated:   'bg-success-light text-success',
  deactivated: 'bg-slate-100 text-text-muted',
  removed:     'bg-danger-light text-danger',
}

export default async function AdminLogsPage() {
  await requireRole('school_admin')
  const supabase = await createClient()

  // No explicit .eq('university_id', ...) filter needed — RLS
  // (school_admin_read_own_action_log) already scopes this to the
  // caller's own university, same pattern used elsewhere in this app.
  const { data: logs } = await supabase
    .from('admin_action_log')
    .select(`
      id, action, created_at,
      actor:actor_id ( full_name ),
      target:target_user_id ( full_name )
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <>
      <TopBar title="Activity Log" subtitle="Account actions at your university" />
      <main className="flex-1 p-6">
        {!logs?.length ? (
          <EmptyState icon={History} title="No activity yet" description="Account actions (activate, deactivate) will appear here." />
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-page">
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">When</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Actor</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Action</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map(log => (
                  <tr key={log.id}>
                    <td className="px-4 py-3 text-text-muted text-xs whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{log.actor?.full_name ?? 'Unknown'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${ACTION_COLORS[log.action] ?? 'bg-slate-100 text-slate-600'}`}>
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-text-primary">{log.target?.full_name ?? 'Unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  )
}
```

- [ ] **Step 3: Add nav entries**

In `components/shared/Sidebar.js`, add `History` to the lucide-react import (currently line 6-10):

```js
import {
  LayoutDashboard, Users, BookOpen, ClipboardList,
  BarChart2, GraduationCap, Building2, Settings,
  FileQuestion, ScrollText, LogOut, Menu, X, History,
} from 'lucide-react'
```

Add a "Logs" entry to the `super_admin` array, after "All Users" and before "Settings" (currently the array at line 14-19):

```js
  super_admin: [
    { label: 'Dashboard',    href: '/super-admin/dashboard',    icon: LayoutDashboard },
    { label: 'Universities', href: '/super-admin/universities', icon: Building2 },
    { label: 'All Users',    href: '/super-admin/users',        icon: Users },
    { label: 'Logs',         href: '/super-admin/logs',         icon: History },
    { label: 'Settings',     href: '/super-admin/settings',     icon: Settings },
  ],
```

Add a "Logs" entry to the `school_admin` array, at the end (currently lines 20-26):

```js
  school_admin: [
    { label: 'Dashboard',         href: '/admin/dashboard',  icon: LayoutDashboard },
    { label: 'Users',             href: '/admin/users',       icon: Users },
    { label: 'Faculties & Depts', href: '/admin/structure',   icon: Building2 },
    { label: 'Courses',           href: '/admin/courses',     icon: BookOpen },
    { label: 'Exam Oversight',    href: '/admin/exams',       icon: ClipboardList },
    { label: 'Logs',              href: '/admin/logs',        icon: History },
  ],
```

Read the file first to confirm these anchors still match the current working-tree content (which already has an uncommitted "Universities" entry from other in-progress work) before editing — match by surrounding array contents, not blind line numbers, if they've drifted.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/super-admin/logs/page.js app/admin/logs/page.js components/shared/Sidebar.js
git commit -m "feat: add activity log pages for super-admin and school-admin"
```

---

### Task 5: Manual browser verification

No files change in this task — the app's server-rendered pages and RLS policies aren't covered by this repo's `environment: 'node'` vitest setup (no jsdom/RLS test harness), so this closes the gap the same way Task 5 did in the draft-persistence plan.

- [ ] **Step 1: Apply the migration**

Run the contents of `supabase/migrations/20260811130000_admin_user_actions_and_log.sql` in the Supabase Dashboard SQL editor. Mark it applied per this repo's convention (add `-- Applied: YYYY-MM-DD` under the file's own header comment).

- [ ] **Step 2: Verify revoke access**

Log in as a super-admin (e.g. `devsuperadmin@gmail.com`, per `seeding.md`). Go to `/super-admin/users`. Click "Deactivate" on a test user; confirm the toast, the row's badge flips to "Inactive," and the row dims. Click "Activate" to restore it; confirm it flips back.

- [ ] **Step 3: Verify self-protection**

Confirm your own super-admin row does not appear in the list at all (excluded by the `.neq('id', user.id)` filter).

- [ ] **Step 4: Verify remove**

Click "Remove" on a different test user. Confirm the modal requires typing the exact name before the "Remove user" button enables. Confirm it. Confirm: toast success, the row now shows a "Removed" badge with no action buttons, and refreshing the page keeps it that way. Confirm that user can no longer log in (`/login?error=account_suspended` on attempt).

- [ ] **Step 5: Verify logs**

Go to `/super-admin/logs`. Confirm the activate/deactivate/remove actions from Steps 2 and 4 all appear, newest first, with correct actor/action/target/university. Log in as a school-admin (`devschooladmin@gmail.com`) and go to `/admin/logs`; confirm they see only rows for users at their own university (deactivate/activate a test user from `/admin/users` first if none exist yet).

- [ ] **Step 6: Report results**

If any step fails, fix the relevant task's code and re-verify before considering this plan complete. If all steps pass, the plan is done — no commit needed for this task.

## Self-Review Notes

- **Spec coverage:** §1 (data model) → Task 1. §2 (server actions) → Task 2. §3 (UI: users page, both log pages, nav) → Tasks 3-4. Manual/migration-application steps → Task 5, mirroring the pattern already established in the draft-persistence plan's own Task 5.
- **Type/signature consistency:** `removed_at`, `admin_action_log`'s column names, and the three `action` enum values (`'activated' | 'deactivated' | 'removed'`) are used identically across the migration (Task 1), both modified/new server actions and their tests (Task 2), and both log pages' `ACTION_LABELS`/`ACTION_COLORS` maps (Task 4).
- **No placeholders:** every step has literal code; the only bracketed text is `<fill in the date you run this>` in the migration's own header comment, filled in by whoever applies it manually, per this repo's established convention (same as the prior question-bank-scoping migration).
