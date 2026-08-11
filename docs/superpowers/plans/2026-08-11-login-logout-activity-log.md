# Login/Logout Activity Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every successful and failed login/logout — staff via password, students via credential-less matric+code/matric+DOB — is written to the existing `admin_action_log` table and visible (filterable by staff/student) on the two log pages shipped earlier today.

**Architecture:** A follow-up migration widens `admin_action_log`'s `action` check constraint and adds two nullable columns (`subject_role`, `target_identifier`). Every new log write goes through `createAdminClient()` (service-role), reusing only data already fetched by the existing auth code paths — no new queries added to the login hot path, only to logout (not brute-force-sensitive). A small local `logAuthEvent` helper in each touched file wraps the insert-and-log-on-failure pattern already established by the prior plan's server actions.

**Tech Stack:** Supabase/PostgreSQL (RLS, manually-applied migrations), Next.js server actions, vitest + `tests/helpers/supabaseMock.js`.

## Global Constraints

- Migrations are SQL files under `supabase/migrations/`, applied manually via the Supabase Dashboard SQL editor. The prior migration (`20260811130000_admin_user_actions_and_log.sql`) is already applied — this is a new file, not an edit to that one.
- No new queries added anywhere inside `signIn`'s or `verifyExamAccess`'s/`verifyResultAccess`'s failure/success paths — every field logged there comes from data the existing code already fetched (or a widened `select(...)` on a query that already runs). `signOut`/`endStudentSession` are the exception — they need one new lookup each, justified because logout isn't brute-force-sensitive.
- Only genuine credential failures are logged as `login_failed` — never rate-limited, "not open yet," "entry closed," or infra-error (e.g. Supabase "Network error") rejections. This mirrors exactly which branches already call the existing `recordFailedAttempt`/general-error handling in each file.
- `mintStudentSession`'s internal kiosk-hygiene `signOut()` (`lib/supabase/studentSession.js:51`) and `proxy.js`'s per-request token refresh are never logged.
- A log-insert failure must never fail the parent action — `console.error` only, matching the existing convention.
- Every log write in this plan uses `createAdminClient()`, never the session-bound client — no new RLS insert policies are added or needed.

---

### Task 1: Migration — widen `admin_action_log` for login/logout

**Files:**
- Create: `supabase/migrations/20260811140000_login_logout_activity_log.sql`

**Interfaces:**
- Produces: `admin_action_log.action` now also accepts `'logged_in' | 'logged_out' | 'login_failed'`; new nullable columns `subject_role user_role`, `target_identifier TEXT`, consumed by Tasks 2-3's server action changes and Task 4's UI filter.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260811140000_login_logout_activity_log.sql`:

```sql
-- Extends admin_action_log (shipped and applied earlier today) to also
-- capture login/logout — successful and failed — across staff (password)
-- and students (credential-less). See docs/superpowers/specs/
-- 2026-08-11-login-logout-activity-log-design.md for the full design.
-- Applied: <fill in the date you run this>

-- The original CHECK constraint was declared inline with no explicit name,
-- so Postgres auto-named it. Find and drop it by inspecting the catalog
-- rather than hardcoding the assumed name, so this migration can't
-- silently no-op against a differently-named constraint.
DO $$
DECLARE
  existing_constraint text;
BEGIN
  SELECT con.conname INTO existing_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'admin_action_log'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%action%';

  IF existing_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE admin_action_log DROP CONSTRAINT %I', existing_constraint);
  END IF;
END $$;

ALTER TABLE admin_action_log ADD CONSTRAINT admin_action_log_action_check
  CHECK (action IN ('activated', 'deactivated', 'removed', 'logged_in', 'logged_out', 'login_failed'));

ALTER TABLE admin_action_log ADD COLUMN IF NOT EXISTS subject_role user_role;
ALTER TABLE admin_action_log ADD COLUMN IF NOT EXISTS target_identifier TEXT;
```

- [ ] **Step 2: Document the manual verification**

Append to the same migration file:

```sql

-- Manual verification: confirm the new check constraint accepts the new
-- values and still rejects garbage:
--
--   INSERT INTO admin_action_log (action, subject_role, target_identifier)
--   VALUES ('logged_in', 'lecturer', 'nobody@example.com'); -- should succeed
--   INSERT INTO admin_action_log (action) VALUES ('bogus');  -- should fail
--
-- Then delete the test row:
--   DELETE FROM admin_action_log WHERE target_identifier = 'nobody@example.com';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260811140000_login_logout_activity_log.sql
git commit -m "feat: widen admin_action_log for login/logout events"
```

---

### Task 2: Staff login/logout logging (`lib/actions/auth.js`)

**Files:**
- Modify: `lib/actions/auth.js`
- Modify: `lib/actions/auth.test.js`

**Interfaces:**
- No change to `signIn`/`signOut`'s exported signatures or return shapes — purely additive internal behavior.

- [ ] **Step 1: Update the implementation**

Replace the full contents of `lib/actions/auth.js` with:

```jsx
'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/dal'
import { loginSchema, forgotPasswordSchema, resetPasswordSchema } from '@/lib/validations/auth'
import { ROLE_HOME } from '@/lib/utils'

async function logAuthEvent(adminClient, fields) {
  const { error } = await adminClient.from('admin_action_log').insert(fields)
  if (error) console.error('[auth] log insert failed', error.message)
}

export async function signIn(prevState, formData) {
  const raw = {
    email: formData.get('email'),
    password: formData.get('password'),
  }

  const parsed = loginSchema.safeParse(raw)
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    // Only a genuine bad-credentials rejection is a security-relevant
    // "login_failed" event — an infra hiccup (network error, etc.) isn't
    // evidence of anyone trying (and failing) to get in. Deliberately no
    // lookup of whether this email belongs to a real account, so logging
    // can never become a new way to detect account existence.
    if (error.message === 'Invalid login credentials') {
      await logAuthEvent(createAdminClient(), {
        action:            'login_failed',
        target_identifier: parsed.data.email,
      })
    }

    return {
      errors: {
        _form: error.message === 'Invalid login credentials'
          ? 'Incorrect email or password. Please try again.'
          : 'Something went wrong. Please try again later.',
      },
    }
  }

  // Fetch role from profile so we can redirect to the right dashboard
  const { data: profile } = await supabase
    .from('users')
    .select('role, university_id')
    .eq('id', data.user.id)
    .single()

  await logAuthEvent(createAdminClient(), {
    university_id:  profile?.university_id ?? null,
    actor_id:       data.user.id,
    action:         'logged_in',
    target_user_id: data.user.id,
    subject_role:   profile?.role ?? null,
  })

  const home = ROLE_HOME[profile?.role] ?? '/login'
  redirect(home)
}

export async function signOut() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const adminClient = createAdminClient()
    const { data: profile } = await adminClient
      .from('users')
      .select('role, university_id')
      .eq('id', user.id)
      .single()

    await logAuthEvent(adminClient, {
      university_id:  profile?.university_id ?? null,
      actor_id:       user.id,
      action:         'logged_out',
      target_user_id: user.id,
      subject_role:   profile?.role ?? null,
    })
  }

  await supabase.auth.signOut()
  redirect('/login')
}

export async function forgotPassword(prevState, formData) {
  const raw = { email: formData.get('email') }

  const parsed = forgotPasswordSchema.safeParse(raw)
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/update-password`,
  })

  // Always return success — avoids leaking whether an email is registered
  if (error) {
    console.error('[forgotPassword]', error.message)
  }

  return { success: true }
}

export async function updatePassword(prevState, formData) {
  // Defense-in-depth: Server Actions are independently callable RPC
  // endpoints, so page-level protection alone isn't enough — a
  // credential-less student session must never be able to set a real,
  // permanent password on their otherwise-passwordless account.
  await requireRole('lecturer', 'school_admin', 'super_admin')

  const raw = {
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  }

  const parsed = resetPasswordSchema.safeParse(raw)
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })

  if (error) {
    return { errors: { _form: 'Failed to update password. The link may have expired.' } }
  }

  redirect('/login?message=password_updated')
}
```

- [ ] **Step 2: Update the tests**

Replace the full contents of `lib/actions/auth.test.js` with:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/dal', () => ({
  requireRole: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path) => { throw new Error(`REDIRECT:${path}`) }),
}))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/dal'
import { signIn, signOut, forgotPassword, updatePassword } from './auth'

function formData(fields) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

const lecturer = { id: 'lect-1', role: 'lecturer', university_id: 'uni-1' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'
  requireRole.mockResolvedValue(lecturer)
})

describe('signIn', () => {
  it('returns validation errors for an invalid email without calling Supabase', async () => {
    const client = createMockSupabaseClient()
    createClient.mockResolvedValue(client)

    const result = await signIn(undefined, formData({ email: 'nope', password: 'secret1' }))

    expect(result.errors.email).toContain('Enter a valid email address')
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('returns a friendly error for invalid credentials and logs a login_failed event', async () => {
    const client = createMockSupabaseClient()
    client.auth.signInWithPassword.mockResolvedValue({ data: null, error: { message: 'Invalid login credentials' } })
    createClient.mockResolvedValue(client)

    const adminClient = createMockSupabaseClient({ admin_action_log: [{ data: null, error: null }] })
    createAdminClient.mockReturnValue(adminClient)

    const result = await signIn(undefined, formData({ email: 'user@example.com', password: 'secret1' }))

    expect(result.errors._form).toBe('Incorrect email or password. Please try again.')
    expect(adminClient.from).toHaveBeenCalledWith('admin_action_log')
  })

  it('returns a generic error for other Supabase auth failures without logging', async () => {
    const client = createMockSupabaseClient()
    client.auth.signInWithPassword.mockResolvedValue({ data: null, error: { message: 'Network error' } })
    createClient.mockResolvedValue(client)

    const result = await signIn(undefined, formData({ email: 'user@example.com', password: 'secret1' }))

    expect(result.errors._form).toBe('Something went wrong. Please try again later.')
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('redirects to the role home on success and logs a logged_in event', async () => {
    const client = createMockSupabaseClient({
      users: [{ data: { role: 'lecturer', university_id: 'uni-1' }, error: null }],
    })
    client.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    createClient.mockResolvedValue(client)

    const adminClient = createMockSupabaseClient({ admin_action_log: [{ data: null, error: null }] })
    createAdminClient.mockReturnValue(adminClient)

    await expect(signIn(undefined, formData({ email: 'user@example.com', password: 'secret1' })))
      .rejects.toThrow('REDIRECT:/lecturer/dashboard')

    expect(adminClient.from).toHaveBeenCalledWith('admin_action_log')
  })
})

describe('signOut', () => {
  it('signs out and redirects to /login, logging a logged_out event', async () => {
    const client = createMockSupabaseClient()
    client.auth.signOut.mockResolvedValue({ error: null })
    client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    createClient.mockResolvedValue(client)

    const adminClient = createMockSupabaseClient({
      users: [{ data: { role: 'lecturer', university_id: 'uni-1' }, error: null }],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    await expect(signOut()).rejects.toThrow(/^REDIRECT:\/login$/)

    expect(client.auth.signOut).toHaveBeenCalled()
    expect(adminClient.from).toHaveBeenCalledWith('admin_action_log')
  })
})

describe('forgotPassword', () => {
  it('returns validation errors for an invalid email', async () => {
    const client = createMockSupabaseClient()
    createClient.mockResolvedValue(client)

    const result = await forgotPassword(undefined, formData({ email: 'nope' }))

    expect(result.errors.email).toBeDefined()
    expect(client.auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('always returns success for a valid email, even if Supabase errors', async () => {
    const client = createMockSupabaseClient()
    client.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'boom' } })
    createClient.mockResolvedValue(client)

    const result = await forgotPassword(undefined, formData({ email: 'user@example.com' }))

    expect(result).toEqual({ success: true })
    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'user@example.com',
      { redirectTo: 'http://localhost:3000/auth/update-password' }
    )
  })
})

describe('updatePassword', () => {
  it('restricts password updates to staff roles', async () => {
    const client = createMockSupabaseClient()
    client.auth.updateUser.mockResolvedValue({ error: null })
    createClient.mockResolvedValue(client)

    await expect(updatePassword(undefined, formData({ password: 'longenough', confirmPassword: 'longenough' })))
      .rejects.toThrow('REDIRECT:/login?message=password_updated')

    expect(requireRole).toHaveBeenCalledWith('lecturer', 'school_admin', 'super_admin')
  })

  it('rejects mismatched passwords', async () => {
    const client = createMockSupabaseClient()
    createClient.mockResolvedValue(client)

    const result = await updatePassword(undefined, formData({ password: 'longenough', confirmPassword: 'different' }))

    expect(result.errors.confirmPassword).toContain('Passwords do not match')
  })

  it('returns a form error when Supabase fails to update the password', async () => {
    const client = createMockSupabaseClient()
    client.auth.updateUser.mockResolvedValue({ error: { message: 'expired' } })
    createClient.mockResolvedValue(client)

    const result = await updatePassword(undefined, formData({ password: 'longenough', confirmPassword: 'longenough' }))

    expect(result.errors._form).toBe('Failed to update password. The link may have expired.')
  })

  it('redirects to /login on success', async () => {
    const client = createMockSupabaseClient()
    client.auth.updateUser.mockResolvedValue({ error: null })
    createClient.mockResolvedValue(client)

    await expect(updatePassword(undefined, formData({ password: 'longenough', confirmPassword: 'longenough' })))
      .rejects.toThrow('REDIRECT:/login?message=password_updated')
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run lib/actions/auth.test.js`
Expected: PASS, all tests.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/auth.js lib/actions/auth.test.js
git commit -m "feat: log staff login/logout events"
```

---

### Task 3: Student login/logout logging (`lib/actions/studentAuth.js`)

**Files:**
- Modify: `lib/actions/studentAuth.js`
- Modify: `lib/actions/studentAuth.test.js`

**Interfaces:**
- No change to `verifyExamAccess`/`verifyResultAccess`/`endStudentSession`'s exported signatures or return shapes.

- [ ] **Step 1: Update the implementation**

Replace the full contents of `lib/actions/studentAuth.js` with:

```jsx
'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { mintStudentSession } from '@/lib/supabase/studentSession'

const RATE_LIMIT_WINDOW_MINUTES = 15
const RATE_LIMIT_MAX_ATTEMPTS   = 5

const GENERIC_ERROR = { error: 'Check your details and try again.' }

// Safe to show as a distinct message — it's keyed only on the submitted
// matric number, not on whether the exam/access-code/DOB was actually
// correct, so it reveals nothing about validity.
const RATE_LIMITED_ERROR = { error: 'Too many attempts. Please wait 15 minutes and try again.' }

// Both of these are also safe to show as distinct messages, and neither
// should cost the student a rate-limit attempt — see the call sites below.
const EXAM_NOT_OPEN_ERROR = { error: "This exam hasn't opened yet. Wait for your lecturer to begin it." }
const ENTRY_CLOSED_ERROR = { error: 'Entry for this exam has closed. Speak to your invigilator.' }

async function getClientIp() {
  const hdrs = await headers()
  return hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

async function isRateLimited(adminClient, matricNumber) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count } = await adminClient
    .from('verification_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('matric_number', matricNumber)
    .gte('created_at', since)
  return (count ?? 0) >= RATE_LIMIT_MAX_ATTEMPTS
}

async function recordFailedAttempt(adminClient, matricNumber, ip) {
  await adminClient.from('verification_attempts').insert({ matric_number: matricNumber, ip })
}

// Clears this matric number's attempt history on a successful verification —
// otherwise a legitimate student who mistypes a few times mid-exam-day stays
// rate-limited even after finally getting it right.
async function clearFailedAttempts(adminClient, matricNumber) {
  await adminClient.from('verification_attempts').delete().eq('matric_number', matricNumber)
}

// Every student auth event logged in this file concerns a student, by
// definition — subject_role is always 'student', overridable only in
// principle via the spread below (never actually overridden today).
async function logAuthEvent(adminClient, fields) {
  const { error } = await adminClient
    .from('admin_action_log')
    .insert({ subject_role: 'student', ...fields })
  if (error) console.error('[studentAuth] log insert failed', error.message)
}

// ─── Enter exam: matric number + per-exam access code ─────────────────────────

const examAccessSchema = z.object({
  matric_number: z.string().min(1),
  access_code:   z.string().length(6),
})

export async function verifyExamAccess(prevState, formData) {
  const parsed = examAccessSchema.safeParse({
    matric_number: formData.get('matric_number')?.trim().toUpperCase(),
    access_code:   formData.get('access_code')?.trim().toUpperCase(),
  })
  if (!parsed.success) return GENERIC_ERROR

  const { matric_number, access_code } = parsed.data
  const ip = await getClientIp()
  const adminClient = createAdminClient()

  if (await isRateLimited(adminClient, matric_number)) return RATE_LIMITED_ERROR

  const { data: exam } = await adminClient
    .from('exams')
    .select('id, university_id, status, go_live_at, entry_window_minutes')
    .eq('access_code', access_code)
    .maybeSingle()

  if (!exam) {
    await recordFailedAttempt(adminClient, matric_number, ip)
    await logAuthEvent(adminClient, { action: 'login_failed', target_identifier: matric_number })
    return GENERIC_ERROR
  }

  // The exam existing but not being live yet reveals nothing about whether
  // this matric number is valid — it's not a credential problem, so it
  // doesn't cost the student a rate-limit attempt.
  if (exam.status !== 'live') return EXAM_NOT_OPEN_ERROR

  const { data: student } = await adminClient
    .from('users')
    .select('id, email, is_active')
    .eq('role', 'student')
    .eq('university_id', exam.university_id)
    .eq('matric_number', matric_number)
    .maybeSingle()

  if (!student || !student.is_active) {
    await recordFailedAttempt(adminClient, matric_number, ip)
    await logAuthEvent(adminClient, student
      ? { action: 'login_failed', target_user_id: student.id, university_id: exam.university_id }
      : { action: 'login_failed', target_identifier: matric_number }
    )
    return GENERIC_ERROR
  }

  // The entry window gates only genuinely NEW attempts — it never affects a
  // student already mid-attempt (governed from here on by their own
  // started_at + duration_minutes, checked in lib/actions/attempts.js) and
  // it never auto-closes the exam's status; "Close Exam" stays a deliberate,
  // separate lecturer action. A student who already has an in-progress
  // attempt on this exam must always be able to get back in regardless of
  // the window — session loss (crash, reboot, accidental sign-out) after
  // the window has closed is otherwise unrecoverable: the attempt would
  // stay in_progress forever with no result and no path back in. So before
  // rejecting on a closed/missing window, check for that escape hatch.
  const entryDeadline = exam.go_live_at
    ? new Date(exam.go_live_at).getTime() + exam.entry_window_minutes * 60 * 1000
    : null
  // A null go_live_at with status already 'live' shouldn't happen
  // (updateExamStatus stamps it on that exact transition) but is treated as
  // "not yet enterable" rather than "no limit" — fail closed, not open.
  const windowOpen = !!entryDeadline && Date.now() <= entryDeadline

  if (!windowOpen) {
    const { data: existingAttempt } = await adminClient
      .from('attempts')
      .select('id')
      .eq('exam_id', exam.id)
      .eq('student_id', student.id)
      .eq('status', 'in_progress')
      .maybeSingle()

    if (!existingAttempt) return ENTRY_CLOSED_ERROR
  }

  const session = await mintStudentSession(student.email, 'exam_access', exam.id)
  if (session.error) return GENERIC_ERROR

  await clearFailedAttempts(adminClient, matric_number)
  await logAuthEvent(adminClient, {
    action:         'logged_in',
    target_user_id: student.id,
    actor_id:       student.id,
    university_id:  exam.university_id,
  })

  redirect(`/lab/${access_code}`)
}

// ─── Check result: matric number + date of birth ───────────────────────────────

const resultAccessSchema = z.object({
  matric_number: z.string().min(1),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function verifyResultAccess(prevState, formData) {
  const parsed = resultAccessSchema.safeParse({
    matric_number: formData.get('matric_number')?.trim().toUpperCase(),
    date_of_birth: formData.get('date_of_birth'),
  })
  if (!parsed.success) return GENERIC_ERROR

  const { matric_number, date_of_birth } = parsed.data
  const ip = await getClientIp()
  const adminClient = createAdminClient()

  if (await isRateLimited(adminClient, matric_number)) return RATE_LIMITED_ERROR

  // No university scoping here — matric numbers are only unique per
  // university, so a cross-university match is treated as ambiguous and
  // rejected the same as no match. See Global Constraints in the plan.
  const { data: students } = await adminClient
    .from('users')
    .select('id, email, is_active, university_id')
    .eq('role', 'student')
    .eq('matric_number', matric_number)
    .eq('date_of_birth', date_of_birth)

  if (!students || students.length !== 1 || !students[0].is_active) {
    await recordFailedAttempt(adminClient, matric_number, ip)
    await logAuthEvent(adminClient, students?.length === 1
      ? { action: 'login_failed', target_user_id: students[0].id, university_id: students[0].university_id }
      : { action: 'login_failed', target_identifier: matric_number }
    )
    return GENERIC_ERROR
  }

  const session = await mintStudentSession(students[0].email, 'result_lookup')
  if (session.error) return GENERIC_ERROR

  await clearFailedAttempts(adminClient, matric_number)
  await logAuthEvent(adminClient, {
    action:         'logged_in',
    target_user_id: students[0].id,
    actor_id:       students[0].id,
    university_id:  students[0].university_id,
  })

  redirect('/check-result')
}

// ─── End session (kiosk hygiene) ────────────────────────────────────────────

// Signs the current student out and sends them back to /lab, so the next
// person at a shared/kiosk machine doesn't inherit the session, and this
// student (or the next one) can start a fresh matric number + access code
// entry for another exam.
// Server Actions are independently callable endpoints, not gated behind the
// component that happens to invoke them in the UI — a caller can supply any
// value here directly, not just the one literal the button passes. So
// `returnTo` is checked against a fixed allowlist rather than passed straight
// to redirect(), which would otherwise let an arbitrary external URL (e.g.
// 'https://evil.example.com') be reflected back as a same-site-trusted
// redirect.
const SAFE_RETURN_PATHS = new Set(['/check-result'])

export async function endStudentSession(code, returnTo) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const adminClient = createAdminClient()
    const { data: profile } = await adminClient
      .from('users')
      .select('university_id')
      .eq('id', user.id)
      .single()

    await logAuthEvent(adminClient, {
      action:         'logged_out',
      target_user_id: user.id,
      actor_id:       user.id,
      university_id:  profile?.university_id ?? null,
    })
  }

  await supabase.auth.signOut()
  // A kiosk lab machine is pre-loaded once, for the whole sitting, to this
  // exam's own /lab/{code} URL — the next student at the same machine
  // should land back on that same matric-entry form, not a generic page
  // that makes them re-discover the code. `returnTo` overrides this for
  // non-exam kiosk contexts (e.g. the /check-result lookup).
  const destination = SAFE_RETURN_PATHS.has(returnTo) ? returnTo : (code ? `/lab/${code}` : '/lab')
  redirect(destination)
}
```

- [ ] **Step 2: Update the tests**

Replace the full contents of `lib/actions/studentAuth.test.js` with:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/studentSession', () => ({ mintStudentSession: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('REDIRECT') }) }))
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Map([['x-forwarded-for', '203.0.113.1']])),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { mintStudentSession } from '@/lib/supabase/studentSession'
import { redirect } from 'next/navigation'
import { verifyExamAccess, verifyResultAccess, endStudentSession } from './studentAuth'

function formData(fields) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

const GENERIC = { error: 'Check your details and try again.' }
const RATE_LIMITED = { error: 'Too many attempts. Please wait 15 minutes and try again.' }
const EXAM_NOT_OPEN = { error: "This exam hasn't opened yet. Wait for your lecturer to begin it." }
const ENTRY_CLOSED = { error: 'Entry for this exam has closed. Speak to your invigilator.' }

beforeEach(() => vi.clearAllMocks())

describe('verifyExamAccess', () => {
  it('rejects an unknown access code without leaking which field was wrong', async () => {
    // Responses: rate-limit count check, recordFailedAttempt insert,
    // admin_action_log insert (login_failed).
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      exams: [{ data: null, error: null }],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))

    expect(result).toEqual(GENERIC)
    expect(mintStudentSession).not.toHaveBeenCalled()
    expect(adminClient.from).toHaveBeenCalledWith('admin_action_log')
  })

  it('mints a session and redirects when matric number and access code both match a live exam', async () => {
    // Responses: rate-limit count check, exams lookup, users lookup,
    // clearFailedAttempts delete, admin_action_log insert (logged_in).
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      exams: [{ data: { id: 'exam-1', university_id: 'uni-1', status: 'live', go_live_at: new Date().toISOString(), entry_window_minutes: 10 }, error: null }],
      users: [{ data: { id: 'stu-1', email: 'csc2021001@uni-1.students.oems.internal', is_active: true }, error: null }],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)
    mintStudentSession.mockResolvedValue({ ok: true })

    await expect(
      verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'abc123' }))
    ).rejects.toThrow('REDIRECT')

    expect(mintStudentSession).toHaveBeenCalledWith('csc2021001@uni-1.students.oems.internal', 'exam_access', 'exam-1')
    expect(redirect).toHaveBeenCalledWith('/lab/ABC123')
    expect(adminClient.from).toHaveBeenCalledWith('admin_action_log')
  })

  it('clears the matric number attempt history on a successful verification', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      exams: [{ data: { id: 'exam-1', university_id: 'uni-1', status: 'live', go_live_at: new Date().toISOString(), entry_window_minutes: 10 }, error: null }],
      users: [{ data: { id: 'stu-1', email: 'csc2021001@uni-1.students.oems.internal', is_active: true }, error: null }],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)
    mintStudentSession.mockResolvedValue({ ok: true })

    await expect(
      verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'abc123' }))
    ).rejects.toThrow('REDIRECT')

    const deleteQuery = adminClient.from.mock.results[3].value
    expect(adminClient.from).toHaveBeenNthCalledWith(4, 'verification_attempts')
    expect(deleteQuery.delete).toHaveBeenCalled()
    expect(deleteQuery.eq).toHaveBeenCalledWith('matric_number', 'CSC/2021/001')
  })

  it('blocks after too many failed attempts for the same matric_number, with a distinct lockout message', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 5 }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))

    expect(result).toEqual(RATE_LIMITED)
    expect(adminClient.from).not.toHaveBeenCalledWith('exams')
  })

  it('normalizes a lower-case matric number to uppercase before matching, so casing never causes a false rejection', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      exams: [{ data: { id: 'exam-1', university_id: 'uni-1', status: 'live', go_live_at: new Date().toISOString(), entry_window_minutes: 10 }, error: null }],
      users: [{ data: { id: 'stu-1', email: 'csc2021001@uni-1.students.oems.internal', is_active: true }, error: null }],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)
    mintStudentSession.mockResolvedValue({ ok: true })

    await expect(
      verifyExamAccess(undefined, formData({ matric_number: 'csc/2021/001', access_code: 'abc123' }))
    ).rejects.toThrow('REDIRECT')

    const usersQuery = adminClient.from.mock.results[2].value
    expect(usersQuery.eq).toHaveBeenCalledWith('matric_number', 'CSC/2021/001')
  })

  it('rate-limits by matric_number alone — the lookup never filters by ip, so a spoofed IP cannot reset the bucket', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 5 }],
    })
    createAdminClient.mockReturnValue(adminClient)

    await verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))

    expect(adminClient.from).toHaveBeenCalledWith('verification_attempts')
    const rateLimitQuery = adminClient.from.mock.results[0].value

    expect(rateLimitQuery.eq).toHaveBeenCalledWith('matric_number', 'CSC/2021/001')
    expect(rateLimitQuery.eq).not.toHaveBeenCalledWith('ip', expect.anything())
    expect(rateLimitQuery.gte).toHaveBeenCalledWith('created_at', expect.any(String))
  })

  it('rejects once the entry window has closed, even though the exam is still live', async () => {
    // No recordFailedAttempt or admin_action_log call for this path — it's
    // not a credential failure. Only one verification_attempts response
    // (the rate-limit count check) is queued. An empty `attempts` response
    // models no in-progress attempt found for the bypass check.
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }],
      exams: [{
        data: {
          id: 'exam-1', university_id: 'uni-1', status: 'live',
          go_live_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // 20 min ago
          entry_window_minutes: 10, // window closed 10 min ago
        },
        error: null,
      }],
      users: [{ data: { id: 'stu-1', email: 'csc2021001@uni-1.students.oems.internal', is_active: true }, error: null }],
      attempts: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))

    expect(result).toEqual(ENTRY_CLOSED)
    expect(mintStudentSession).not.toHaveBeenCalled()
    expect(adminClient.from).not.toHaveBeenCalledWith('admin_action_log')
  })

  it('rejects when go_live_at is still null despite status being live (fails closed)', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }],
      exams: [{
        data: { id: 'exam-1', university_id: 'uni-1', status: 'live', go_live_at: null, entry_window_minutes: 10 },
        error: null,
      }],
      users: [{ data: { id: 'stu-1', email: 'csc2021001@uni-1.students.oems.internal', is_active: true }, error: null }],
      attempts: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))

    expect(result).toEqual(ENTRY_CLOSED)
    expect(mintStudentSession).not.toHaveBeenCalled()
  })

  it('returns a distinct "not open" error and does not record a failed attempt when the exam exists but is not live', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }],
      exams: [{
        data: { id: 'exam-1', university_id: 'uni-1', status: 'scheduled', go_live_at: null, entry_window_minutes: 10 },
        error: null,
      }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))

    expect(result).toEqual(EXAM_NOT_OPEN)
    expect(mintStudentSession).not.toHaveBeenCalled()
    expect(adminClient.from).not.toHaveBeenCalledWith('users')
    // Only the rate-limit count query touched verification_attempts — no
    // recordFailedAttempt insert or admin_action_log write followed it.
    expect(adminClient.from).toHaveBeenCalledTimes(2)
  })

  it('lets a student with an existing in-progress attempt back in even though the entry window has closed', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      exams: [{
        data: {
          id: 'exam-1', university_id: 'uni-1', status: 'live',
          go_live_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // 20 min ago
          entry_window_minutes: 10, // window closed 10 min ago
        },
        error: null,
      }],
      users: [{ data: { id: 'stu-1', email: 'csc2021001@uni-1.students.oems.internal', is_active: true }, error: null }],
      attempts: [{ data: { id: 'attempt-1' }, error: null }],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)
    mintStudentSession.mockResolvedValue({ ok: true })

    await expect(
      verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))
    ).rejects.toThrow('REDIRECT')

    expect(mintStudentSession).toHaveBeenCalledWith('csc2021001@uni-1.students.oems.internal', 'exam_access', 'exam-1')
    expect(redirect).toHaveBeenCalledWith('/lab/ABC123')
  })
})

describe('verifyResultAccess', () => {
  it('rejects when matric number + date of birth match zero students', async () => {
    // Responses: rate-limit count check, users lookup, recordFailedAttempt
    // insert, admin_action_log insert (login_failed).
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      users: [{ data: [], error: null }],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyResultAccess(undefined, formData({ matric_number: 'CSC/2021/001', date_of_birth: '2003-04-12' }))

    expect(result).toEqual(GENERIC)
    expect(adminClient.from).toHaveBeenCalledWith('admin_action_log')
  })

  it('rejects when matric number + date of birth match more than one student (cross-university collision)', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      users: [{ data: [{ id: 'a', email: 'a@x', is_active: true }, { id: 'b', email: 'b@x', is_active: true }], error: null }],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyResultAccess(undefined, formData({ matric_number: 'CSC/2021/001', date_of_birth: '2003-04-12' }))

    expect(result).toEqual(GENERIC)
    expect(mintStudentSession).not.toHaveBeenCalled()
  })

  it('mints a session and redirects to /check-result on exactly one match', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      users: [{ data: [{ id: 'a', email: 'a@uni-1.students.oems.internal', is_active: true, university_id: 'uni-1' }], error: null }],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)
    mintStudentSession.mockResolvedValue({ ok: true })

    await expect(
      verifyResultAccess(undefined, formData({ matric_number: 'CSC/2021/001', date_of_birth: '2003-04-12' }))
    ).rejects.toThrow('REDIRECT')

    expect(mintStudentSession).toHaveBeenCalledWith('a@uni-1.students.oems.internal', 'result_lookup')
    expect(redirect).toHaveBeenCalledWith('/check-result')
    expect(adminClient.from).toHaveBeenCalledWith('admin_action_log')
  })

  it('clears the matric number attempt history on a successful verification', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      users: [{ data: [{ id: 'a', email: 'a@uni-1.students.oems.internal', is_active: true, university_id: 'uni-1' }], error: null }],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)
    mintStudentSession.mockResolvedValue({ ok: true })

    await expect(
      verifyResultAccess(undefined, formData({ matric_number: 'CSC/2021/001', date_of_birth: '2003-04-12' }))
    ).rejects.toThrow('REDIRECT')

    const deleteQuery = adminClient.from.mock.results[2].value
    expect(adminClient.from).toHaveBeenNthCalledWith(3, 'verification_attempts')
    expect(deleteQuery.delete).toHaveBeenCalled()
    expect(deleteQuery.eq).toHaveBeenCalledWith('matric_number', 'CSC/2021/001')
  })

  it('blocks after too many failed attempts, with a distinct lockout message', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 5 }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyResultAccess(undefined, formData({ matric_number: 'CSC/2021/001', date_of_birth: '2003-04-12' }))

    expect(result).toEqual(RATE_LIMITED)
    expect(adminClient.from).not.toHaveBeenCalledWith('users')
  })
})

describe('endStudentSession', () => {
  it('signs out and redirects to /lab, so a shared/kiosk machine does not inherit the session', async () => {
    const client = createMockSupabaseClient()
    client.auth.signOut.mockResolvedValue({ error: null })
    client.auth.getUser.mockResolvedValue({ data: { user: { id: 'stu-1' } } })
    createClient.mockResolvedValue(client)

    const adminClient = createMockSupabaseClient({
      users: [{ data: { university_id: 'uni-1' }, error: null }],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    await expect(endStudentSession()).rejects.toThrow('REDIRECT')

    expect(client.auth.signOut).toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith('/lab')
    expect(adminClient.from).toHaveBeenCalledWith('admin_action_log')
  })

  it('redirects to the allowlisted /check-result path when passed as returnTo', async () => {
    const client = createMockSupabaseClient()
    client.auth.signOut.mockResolvedValue({ error: null })
    client.auth.getUser.mockResolvedValue({ data: { user: { id: 'stu-1' } } })
    createClient.mockResolvedValue(client)

    const adminClient = createMockSupabaseClient({
      users: [{ data: { university_id: 'uni-1' }, error: null }],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    await expect(endStudentSession(null, '/check-result')).rejects.toThrow('REDIRECT')

    expect(redirect).toHaveBeenCalledWith('/check-result')
  })

  it('ignores an arbitrary returnTo instead of redirecting off-site (open-redirect guard)', async () => {
    const client = createMockSupabaseClient()
    client.auth.signOut.mockResolvedValue({ error: null })
    client.auth.getUser.mockResolvedValue({ data: { user: { id: 'stu-1' } } })
    createClient.mockResolvedValue(client)

    const adminClient = createMockSupabaseClient({
      users: [{ data: { university_id: 'uni-1' }, error: null }],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    await expect(endStudentSession(null, 'https://evil.example.com')).rejects.toThrow('REDIRECT')

    expect(redirect).toHaveBeenCalledWith('/lab')
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run lib/actions/studentAuth.test.js`
Expected: PASS, all tests.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/studentAuth.js lib/actions/studentAuth.test.js
git commit -m "feat: log student login/logout events"
```

---

### Task 4: Staff/student filter on both log pages

**Files:**
- Modify: `app/super-admin/logs/page.js`
- Modify: `app/admin/logs/page.js`

**Interfaces:**
- No new exports — leaf pages.

- [ ] **Step 1: Update the super-admin log page**

Read `app/super-admin/logs/page.js` first to confirm no drift, then replace its full contents with:

```jsx
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { History } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata = { title: 'Activity Log — OEMS' }

const ACTION_LABELS = {
  activated:    'Activated',
  deactivated:  'Deactivated',
  removed:      'Removed',
  logged_in:    'Logged in',
  logged_out:   'Logged out',
  login_failed: 'Login failed',
}

const ACTION_COLORS = {
  activated:    'bg-success-light text-success',
  deactivated:  'bg-slate-100 text-text-muted',
  removed:      'bg-danger-light text-danger',
  logged_in:    'bg-success-light text-success',
  logged_out:   'bg-slate-100 text-text-muted',
  login_failed: 'bg-danger-light text-danger',
}

const STAFF_ROLES = ['lecturer', 'school_admin', 'super_admin']

export default async function SuperAdminLogsPage({ searchParams }) {
  await requireRole('super_admin')
  const supabase = await createClient()
  const { role: roleFilter } = await searchParams

  let query = supabase
    .from('admin_action_log')
    .select(`
      id, action, created_at, subject_role, target_identifier,
      actor:actor_id ( full_name ),
      target:target_user_id ( full_name ),
      universities:university_id ( name )
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  if (roleFilter === 'staff') query = query.in('subject_role', STAFF_ROLES)
  if (roleFilter === 'students') query = query.eq('subject_role', 'student')

  const { data: logs } = await query

  return (
    <>
      <TopBar title="Activity Log" subtitle="Account actions and sign-ins across the platform" />
      <main className="flex-1 p-6 space-y-4">
        <form className="flex items-center gap-2">
          <label htmlFor="role" className="text-xs font-medium text-text-muted">Show</label>
          <select
            id="role"
            name="role"
            defaultValue={roleFilter ?? ''}
            className="text-sm border border-border rounded-lg px-2.5 py-1.5 bg-surface"
          >
            <option value="">All</option>
            <option value="staff">Staff</option>
            <option value="students">Students</option>
          </select>
          <button type="submit" className="text-xs font-medium text-primary hover:underline">Apply</button>
        </form>

        {!logs?.length ? (
          <EmptyState icon={History} title="No activity yet" description="Account actions and sign-ins will appear here." />
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
                    <td className="px-4 py-3 text-text-secondary">{log.actor?.full_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${ACTION_COLORS[log.action] ?? 'bg-slate-100 text-slate-600'}`}>
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-text-primary">
                      {log.target?.full_name ?? log.target_identifier ?? 'Unknown'}
                    </td>
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

- [ ] **Step 2: Update the school-admin log page**

Read `app/admin/logs/page.js` first to confirm no drift, then replace its full contents with:

```jsx
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { History } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata = { title: 'Activity Log — OEMS' }

const ACTION_LABELS = {
  activated:    'Activated',
  deactivated:  'Deactivated',
  removed:      'Removed',
  logged_in:    'Logged in',
  logged_out:   'Logged out',
  login_failed: 'Login failed',
}

const ACTION_COLORS = {
  activated:    'bg-success-light text-success',
  deactivated:  'bg-slate-100 text-text-muted',
  removed:      'bg-danger-light text-danger',
  logged_in:    'bg-success-light text-success',
  logged_out:   'bg-slate-100 text-text-muted',
  login_failed: 'bg-danger-light text-danger',
}

const STAFF_ROLES = ['lecturer', 'school_admin', 'super_admin']

export default async function AdminLogsPage({ searchParams }) {
  await requireRole('school_admin')
  const supabase = await createClient()
  const { role: roleFilter } = await searchParams

  // No explicit .eq('university_id', ...) filter needed — RLS
  // (school_admin_read_own_action_log) already scopes this to the
  // caller's own university, same pattern used elsewhere in this app.
  let query = supabase
    .from('admin_action_log')
    .select(`
      id, action, created_at, subject_role, target_identifier,
      actor:actor_id ( full_name ),
      target:target_user_id ( full_name )
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  if (roleFilter === 'staff') query = query.in('subject_role', STAFF_ROLES)
  if (roleFilter === 'students') query = query.eq('subject_role', 'student')

  const { data: logs } = await query

  return (
    <>
      <TopBar title="Activity Log" subtitle="Account actions and sign-ins at your university" />
      <main className="flex-1 p-6 space-y-4">
        <form className="flex items-center gap-2">
          <label htmlFor="role" className="text-xs font-medium text-text-muted">Show</label>
          <select
            id="role"
            name="role"
            defaultValue={roleFilter ?? ''}
            className="text-sm border border-border rounded-lg px-2.5 py-1.5 bg-surface"
          >
            <option value="">All</option>
            <option value="staff">Staff</option>
            <option value="students">Students</option>
          </select>
          <button type="submit" className="text-xs font-medium text-primary hover:underline">Apply</button>
        </form>

        {!logs?.length ? (
          <EmptyState icon={History} title="No activity yet" description="Account actions and sign-ins will appear here." />
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
                    <td className="px-4 py-3 text-text-secondary">{log.actor?.full_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${ACTION_COLORS[log.action] ?? 'bg-slate-100 text-slate-600'}`}>
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-text-primary">
                      {log.target?.full_name ?? log.target_identifier ?? 'Unknown'}
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
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/super-admin/logs/page.js app/admin/logs/page.js
git commit -m "feat: add staff/student filter to activity log pages"
```

---

### Task 5: Manual browser verification

No files change in this task.

- [ ] **Step 1: Apply the migration**

Run `supabase/migrations/20260811140000_login_logout_activity_log.sql` in the Supabase Dashboard SQL editor. Mark it applied per this repo's convention.

- [ ] **Step 2: Verify staff login/logout logging**

Log out, then log in as a lecturer with a deliberately wrong password once (should see the normal "Incorrect email or password" message, nothing different in the UI), then log in correctly. Log out. Go to `/super-admin/logs` as super-admin: confirm you see a `login_failed` row (target shown as the typed email, since no account was resolved for it — actually a real account exists here, so check: does the `login_failed` row show "Unknown" since target_user_id is intentionally never set on this path, only target_identifier? Confirm this matches the design — a resolved-but-wrong-password attempt is deliberately NOT linked to the real account it named), a `logged_in` row, and a `logged_out` row, each with the correct actor/target name and timestamp order.

- [ ] **Step 3: Verify student login/logout logging**

As a student, enter a wrong access code once (see `verification_attempts` rate-limit unaffected), then access a live exam correctly, then use "end session" if available in the lab UI. Check `/super-admin/logs` (filtered to "Students") for the corresponding `login_failed`/`logged_in`/`logged_out` rows.

- [ ] **Step 4: Verify the staff/student filter**

On `/super-admin/logs`, switch the filter between All/Staff/Students and confirm the row set changes accordingly. Repeat on `/admin/logs` as a school-admin, confirming it only ever shows that university's own rows regardless of filter.

- [ ] **Step 5: Report results**

If any step fails, fix the relevant task's code and re-verify before considering this plan complete. If all steps pass, the plan is done — no commit needed for this task.

## Self-Review Notes

- **Spec coverage:** §1 (schema) → Task 1. §2 (every logging call site, including the explicit exclusions: kiosk-hygiene signOut, proxy.js refresh, non-credential failure branches) → Tasks 2-3. §3 (UI filter) → Task 4. Non-goals (no rate-limit changes, no failure-lookup enrichment, no exam-access-vs-result-lookup distinction, no visibility change) — none of them have a task, correctly.
- **Type/signature consistency:** `admin_action_log`'s new columns (`subject_role`, `target_identifier`) and the three new `action` values are used identically across the migration (Task 1), both `logAuthEvent` helpers and every call site (Tasks 2-3), and both log pages' label/color maps and query filters (Task 4). The `logAuthEvent(adminClient, fields)` signature is the same shape in both files, even though they're independent local helpers (no shared module — each file's version is small enough that extracting a shared one would be premature, and `studentAuth.js`'s version has a file-specific default (`subject_role: 'student'`) that doesn't belong in a generic shared helper).
- **No placeholders:** every step has literal, complete code — both touched test files are reproduced in full (not diffed) given how many individual existing tests needed a queued-response addition to avoid breaking on the new `.from('admin_action_log')` calls; a partial diff description would have been much higher-risk here than the verbose-but-unambiguous full-file replacement. The only bracketed text is `<fill in the date you run this>` in the migration's own header comment, filled in manually per this repo's established convention.
