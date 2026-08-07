# Credential-less Student Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace password-based student accounts with a credential-less flow — matric number + per-exam access code to sit an exam, matric number + date of birth to check an already-released result — while leaving staff (lecturer/school_admin/super_admin) auth untouched.

**Architecture:** Students still get a real `auth.users` row (required by the existing `public.users.id → auth.users.id` foreign key and the RLS model built on it), but never a usable password. Two new Server Actions verify a student's claim (matric+code / matric+DOB) against the roster using the service-role client, then mint a real session server-side via Supabase's passwordless `generateLink` + `verifyOtp` pair before redirecting into the existing (unchanged) exam and results pages.

**Tech Stack:** Next.js 16 App Router Server Actions, Supabase JS (`@supabase/supabase-js`, `@supabase/ssr`), Zod, Vitest (Node environment) with the existing `tests/helpers/supabaseMock.js` mock.

## Global Constraints

- Students never have a password — not hidden, not auto-generated and discarded. `auth.users.createUser` is called with no `password` field at all. (spec: Session-minting mechanism)
- Staff (lecturer/school_admin/super_admin) auth is completely unaffected by this plan — still email + password via the existing `inviteUser` flow. (spec: Non-goals)
- No migration path for existing student accounts — confirmed pre-launch, demo/test data only. (spec: Non-goals)
- Eligibility logic (which students can access which exam) is unchanged — this plan only changes how a student authenticates. (spec: Goal)
- Error messages for both verification flows are a single generic string ("Check your details and try again.") in every failure case — never reveal which field was wrong. (spec: Error handling)
- Rate limit: 5 failed attempts per `(matric_number, ip)` per 15 minutes, tracked in `verification_attempts`. (spec: Error handling)
- `date_of_birth` result-lookup is matched with no university scoping. Matric numbers are only unique *per university* (`unique_matric_per_university` index), so a cross-university collision is possible in a multi-tenant deployment. If more than one row matches, treat it exactly like zero matches (generic error) — never guess. This is a known limitation tied to the still-open "confirm multi-tenancy intent" ticket, not something this plan resolves.
- Test runner is Vitest, `environment: 'node'` — no component/DOM test coverage in this round (existing constraint from the testing-setup plan, still true here). UI components in this plan are verified manually via the dev server, not with component tests.
- Migrations are applied manually via the Supabase SQL editor, per `supabase/migrations/README.md` — this plan does not add CI/automated migration tooling (that's a separate, already-tracked ticket).

---

### Task 1: Migration — schema changes for credential-less student auth

**Files:**
- Create: `supabase/migrations/20260807120000_credentialless_student_auth.sql`

**Interfaces:**
- Produces: `users.date_of_birth` (DATE, nullable), `exams.access_code` (renamed from `exams.lab_code`, same UNIQUE text column, no mode restriction), `verification_attempts` table `(id, matric_number, ip, created_at)`, updated `public.handle_new_user()` trigger function that also sets `date_of_birth` from signup metadata.

This is a database-only change with no application logic to unit test — consistent with how this codebase already treats RLS/SQL correctness (manual review, not Vitest). Verification here is a manual SQL check against a linked Supabase project, matching the existing migration workflow.

- [ ] **Step 1: Write the migration file**

```sql
-- Credential-less student authentication
-- Applied: (pending)

-- date_of_birth: verifies a student's identity when checking an
-- already-released result outside an active exam session.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- access_code generalizes lab_code to every exam, not just lab-mode ones —
-- both lab and remote exams now use a shared per-exam code as part of the
-- credential-less student entry flow.
ALTER TABLE exams RENAME COLUMN lab_code TO access_code;

-- handle_new_user: pass date_of_birth through from signup metadata,
-- the same way matric_number/level already are.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role, university_id, matric_number, level, date_of_birth, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    (NEW.raw_user_meta_data->>'role')::user_role,
    (NEW.raw_user_meta_data->>'university_id')::uuid,
    NEW.raw_user_meta_data->>'matric_number',
    (NEW.raw_user_meta_data->>'level')::student_level,
    (NEW.raw_user_meta_data->>'date_of_birth')::date,
    TRUE
  );
  RETURN NEW;
END;
$$;

-- verification_attempts: throttle for the two credential-less verification
-- endpoints (matric+access_code, matric+date_of_birth). Only ever touched
-- via the service-role client from Server Actions — no student-facing
-- RLS policy needed, default-deny is correct.
CREATE TABLE IF NOT EXISTS verification_attempts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  matric_number  TEXT NOT NULL,
  ip             TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_attempts_lookup
  ON verification_attempts (matric_number, ip, created_at);

ALTER TABLE verification_attempts ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply it manually and verify**

Open the Supabase dashboard → SQL Editor → paste the migration → Run. Then run these checks in the same editor:

```sql
-- Confirm the rename and new column
SELECT column_name FROM information_schema.columns
WHERE table_name = 'exams' AND column_name = 'access_code';
SELECT column_name FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'date_of_birth';

-- Confirm the throttle table exists
SELECT to_regclass('public.verification_attempts');

-- Confirm the trigger function was replaced without error
SELECT prosrc FROM pg_proc WHERE proname = 'handle_new_user';
```

Expected: all four queries return non-null results; the last one's output contains `date_of_birth`.

- [ ] **Step 3: Mark the migration applied and commit**

Add `-- Applied: 2026-08-07` to the top of the migration file (per `supabase/migrations/README.md` convention), then:

```bash
git add supabase/migrations/20260807120000_credentialless_student_auth.sql
git commit -m "feat: add date_of_birth, rename lab_code to access_code, add verification_attempts table"
```

---

### Task 2: Extend the shared Supabase test mock for auth/count operations

**Files:**
- Modify: `tests/helpers/supabaseMock.js`
- Test: `tests/helpers/supabaseMock.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `createMockSupabaseClient` now also chains `.maybeSingle()` and `.gte()`, and exposes `auth.admin.generateLink`, `auth.verifyOtp` as `vi.fn()`s — needed by Tasks 4 and 7's tests.

- [ ] **Step 1: Write the failing test**

Add to `tests/helpers/supabaseMock.test.js` (existing file — append a new `describe` block):

```js
describe('createMockSupabaseClient auth surface', () => {
  it('exposes generateLink and verifyOtp as mock functions', () => {
    const client = createMockSupabaseClient()
    expect(client.auth.admin.generateLink).toBeTypeOf('function')
    expect(client.auth.verifyOtp).toBeTypeOf('function')
  })

  it('chains maybeSingle and gte like the other query methods', () => {
    const client = createMockSupabaseClient({ users: [{ data: { id: 'u1' }, error: null }] })
    const builder = client.from('users').select('*').eq('id', 'u1').gte('created_at', '2026-01-01').maybeSingle()
    expect(builder).toBeDefined()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- tests/helpers/supabaseMock.test.js`
Expected: FAIL — `client.auth.admin.generateLink` is undefined, and `.gte`/`.maybeSingle` are not functions on the builder.

- [ ] **Step 3: Extend the mock helper**

In `tests/helpers/supabaseMock.js`, change the chain-methods list and the returned `auth` object:

```js
const CHAIN_METHODS = ['select', 'eq', 'in', 'order', 'single', 'maybeSingle', 'gte', 'update', 'insert', 'upsert']
```

```js
    auth: {
      getUser: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      verifyOtp: vi.fn(),
      admin: {
        createUser: vi.fn(),
        generateLink: vi.fn(),
      },
    },
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -- tests/helpers/supabaseMock.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite to confirm nothing else broke, then commit**

Run: `npm test`
Expected: all existing tests still PASS (this change only adds surface, doesn't remove any).

```bash
git add tests/helpers/supabaseMock.js tests/helpers/supabaseMock.test.js
git commit -m "test: extend Supabase mock with generateLink, verifyOtp, maybeSingle, gte"
```

---

### Task 3: Rename `lab_code` to `access_code` in application code

**Files:**
- Modify: `lib/actions/exams.js:222-255`
- Modify: `components/exams/LabCodePanel.js` → rename to `components/exams/AccessCodePanel.js`
- Modify: `app/lecturer/exams/[id]/page.js:28, 135-142`
- Modify: `app/lab/[code]/page.js:23`
- Test: `lib/actions/exams.test.js` (new file)

**Interfaces:**
- Consumes: Task 1's `exams.access_code` column.
- Produces: `generateAccessCode(examId)` in `lib/actions/exams.js`, returning `{ access_code: string } | { error: string }` — replaces `generateLabCode`. `AccessCodePanel` component with props `{ examId, accessCode, examStatus }` — replaces `LabCodePanel`.

- [ ] **Step 1: Write the failing test**

Create `lib/actions/exams.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/dal', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { generateAccessCode } from './exams'

const lecturer = { id: 'lect-1', role: 'lecturer', university_id: 'uni-1' }

beforeEach(() => {
  vi.clearAllMocks()
  requireRole.mockResolvedValue(lecturer)
})

describe('generateAccessCode', () => {
  it('returns an error when the exam is not owned by this lecturer', async () => {
    const supabase = createMockSupabaseClient({ exams: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await generateAccessCode('exam-1')

    expect(result).toEqual({ error: 'Exam not found.' })
  })

  it('generates and persists a 6-character access code without forcing exam_mode', async () => {
    const supabase = createMockSupabaseClient({
      exams: [
        { data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1' }, error: null }, // getOwnedExam
        { data: null, error: null }, // collision check
        { data: null, error: null }, // the update itself
      ],
    })
    createClient.mockResolvedValue(supabase)

    const result = await generateAccessCode('exam-1')

    expect(result.access_code).toMatch(/^[A-Z0-9]{6}$/)
    expect(result.error).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- lib/actions/exams.test.js`
Expected: FAIL — `generateAccessCode` is not exported from `./exams`.

- [ ] **Step 3: Rename in `lib/actions/exams.js`**

Replace the "Lab code" section (current lines 222–255):

```js
// ─── Access code ──────────────────────────────────────────────────────────

function randomAccessCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no O, 0, I, 1 — visually ambiguous
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function generateAccessCode(examId) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }

  // Generate a unique code (retry on collision — extremely rare)
  let code, attempts = 0
  while (attempts < 5) {
    code = randomAccessCode()
    const { data: existing } = await supabase
      .from('exams').select('id').eq('access_code', code).maybeSingle()
    if (!existing) break
    attempts++
  }

  const { error } = await supabase
    .from('exams')
    .update({ access_code: code })
    .eq('id', examId)

  if (error) return { error: 'Failed to generate access code.' }

  revalidateExam(examId)
  return { access_code: code }
}
```

Note this drops the `exam_mode: 'lab'` side effect from the old `.update()` call — access codes now apply to both `remote` and `lab` exams, so generating one no longer changes the exam's mode.

- [ ] **Step 4: Rename the component**

Move `components/exams/LabCodePanel.js` to `components/exams/AccessCodePanel.js`:

```js
'use client'

import { useState } from 'react'
import { Copy, Check, RefreshCw, Loader2, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { generateAccessCode } from '@/lib/actions/exams'

export function AccessCodePanel({ examId, accessCode: initialCode, examStatus }) {
  const [code,        setCode]        = useState(initialCode)
  const [copied,      setCopied]      = useState(false)
  const [generating,  setGenerating]  = useState(false)

  const canGenerate = examStatus === 'live' || examStatus === 'scheduled' || examStatus === 'draft'

  async function handleCopy() {
    if (!code) return
    await navigator.clipboard.writeText(code)
    setCopied(true)
    toast.success('Access code copied')
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleGenerate() {
    setGenerating(true)
    const result = await generateAccessCode(examId)
    setGenerating(false)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    setCode(result.access_code)
    toast.success('New access code generated')
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <KeyRound size={15} className="text-primary" />
        <h3 className="text-sm font-semibold text-text-primary">Exam Access Code</h3>
      </div>

      {code ? (
        <>
          <p className="text-xs text-text-muted mb-2">
            Share this code with students. They enter it, with their matric number, at{' '}
            <span className="font-mono text-text-secondary">/lab</span>.
          </p>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 bg-slate-50 border border-border rounded-xl px-4 py-3 text-center">
              <span className="text-2xl font-mono font-bold tracking-[0.3em] text-text-primary">
                {code}
              </span>
            </div>
            <button
              onClick={handleCopy}
              className="p-3 border border-border rounded-xl text-text-muted hover:text-primary hover:border-primary/30 transition-colors"
              title="Copy code"
            >
              {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
            </button>
          </div>
          {canGenerate && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full flex items-center justify-center gap-2 py-2 text-xs text-text-muted border border-border rounded-lg hover:text-text-primary hover:border-border transition-colors disabled:opacity-50"
            >
              {generating
                ? <><Loader2 size={12} className="animate-spin" /> Generating…</>
                : <><RefreshCw size={12} /> Regenerate code</>
              }
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-text-muted mb-3">
            Generate a code so students can access this exam.
          </p>
          {canGenerate && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              {generating
                ? <><Loader2 size={14} className="animate-spin" /> Generating…</>
                : 'Generate Access Code'
              }
            </button>
          )}
        </>
      )}
    </div>
  )
}
```

Delete the old `components/exams/LabCodePanel.js`.

- [ ] **Step 5: Update the lecturer exam detail page**

In `app/lecturer/exams/[id]/page.js`:
- Line 8: `import { LabCodePanel } from '@/components/exams/LabCodePanel'` → `import { AccessCodePanel } from '@/components/exams/AccessCodePanel'`
- Line 28: `exam_mode, lab_code, proctoring_enabled, show_calculator, tips,` → `exam_mode, access_code, proctoring_enabled, show_calculator, tips,`
- Lines 135–142: remove the `exam_mode === 'lab'` gate (access codes now apply to every exam) and rename the prop:

```jsx
          <AccessCodePanel
            examId={id}
            accessCode={exam.access_code}
            examStatus={exam.status}
          />
```

- [ ] **Step 6: Update the student lab lobby query column**

In `app/lab/[code]/page.js` line 23: `.eq('lab_code', code.toUpperCase())` → `.eq('access_code', code.toUpperCase())`.

- [ ] **Step 7: Run the test to confirm it passes**

Run: `npm test -- lib/actions/exams.test.js`
Expected: PASS

- [ ] **Step 8: Manually verify in the dev server**

Run: `npm run dev`. As a lecturer, open a `remote`-mode exam's detail page and confirm the "Exam Access Code" panel now appears (previously it was hidden for non-lab exams) and generates a code successfully.

- [ ] **Step 9: Run the full suite and commit**

Run: `npm test`
Expected: all tests PASS.

```bash
git add lib/actions/exams.js lib/actions/exams.test.js components/exams/AccessCodePanel.js app/lecturer/exams/\[id\]/page.js app/lab/\[code\]/page.js
git rm components/exams/LabCodePanel.js
git commit -m "refactor: rename lab_code to access_code, generalize to all exam modes"
```

---

### Task 4: Passwordless session-minting helper

**Files:**
- Create: `lib/supabase/studentSession.js`
- Test: `lib/supabase/studentSession.test.js`

**Interfaces:**
- Consumes: `createAdminClient` (`lib/supabase/admin.js`), `createClient` (`lib/supabase/server.js`), Task 2's extended mock.
- Produces: `mintStudentSession(email)` → `Promise<{ ok: true } | { error: string }>`. Used by Task 7's `verifyExamAccess` and `verifyResultAccess`.

- [ ] **Step 1: Write the failing test**

Create `lib/supabase/studentSession.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { mintStudentSession } from './studentSession'

beforeEach(() => vi.clearAllMocks())

describe('mintStudentSession', () => {
  it('signs out any existing session, then verifies the generated magic link to establish a new one', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: 'tok_123' } },
      error: null,
    })
    createAdminClient.mockReturnValue(adminClient)

    const serverClient = createMockSupabaseClient()
    serverClient.auth.verifyOtp.mockResolvedValue({ data: {}, error: null })
    createClient.mockResolvedValue(serverClient)

    const result = await mintStudentSession('matric-1@uni-1.students.oems.internal')

    expect(adminClient.auth.admin.generateLink).toHaveBeenCalledWith({
      type: 'magiclink',
      email: 'matric-1@uni-1.students.oems.internal',
    })
    // signOut must run before verifyOtp — prevents session bleed on shared/kiosk machines.
    expect(serverClient.auth.signOut.mock.invocationCallOrder[0])
      .toBeLessThan(serverClient.auth.verifyOtp.mock.invocationCallOrder[0])
    expect(serverClient.auth.verifyOtp).toHaveBeenCalledWith({
      type: 'magiclink',
      token_hash: 'tok_123',
    })
    expect(result).toEqual({ ok: true })
  })

  it('returns a generic error if the link cannot be generated', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.generateLink.mockResolvedValue({ data: null, error: { message: 'boom' } })
    createAdminClient.mockReturnValue(adminClient)

    const result = await mintStudentSession('x@y.internal')

    expect(result).toEqual({ error: 'Could not start session.' })
  })

  it('returns a generic error if verifyOtp fails', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: 'tok_123' } },
      error: null,
    })
    createAdminClient.mockReturnValue(adminClient)

    const serverClient = createMockSupabaseClient()
    serverClient.auth.verifyOtp.mockResolvedValue({ data: null, error: { message: 'expired' } })
    createClient.mockResolvedValue(serverClient)

    const result = await mintStudentSession('x@y.internal')

    expect(result).toEqual({ error: 'Could not start session.' })
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- lib/supabase/studentSession.test.js`
Expected: FAIL — `./studentSession` doesn't exist.

- [ ] **Step 3: Implement `lib/supabase/studentSession.js`**

```js
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const GENERIC_SESSION_ERROR = { error: 'Could not start session.' }

/**
 * Establishes a real Supabase session for a verified, credential-less
 * student — no password is ever generated or used. Uses the admin API to
 * generate a one-time magic-link token, then verifies it server-side to
 * set the session cookie in this request.
 */
export async function mintStudentSession(email) {
  const adminClient = createAdminClient()

  const { data, error } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  if (error || !data?.properties?.hashed_token) {
    return GENERIC_SESSION_ERROR
  }

  const supabase = await createClient()

  // Prevent session bleed between students sharing a kiosk/lab machine.
  await supabase.auth.signOut()

  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: data.properties.hashed_token,
  })

  if (verifyError) {
    return GENERIC_SESSION_ERROR
  }

  return { ok: true }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- lib/supabase/studentSession.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/studentSession.js lib/supabase/studentSession.test.js
git commit -m "feat: add passwordless session-minting helper for credential-less students"
```

---

### Task 5: Bulk roster upload action; remove students from the staff invite flow

**Files:**
- Modify: `lib/actions/admin.js:19-89`
- Modify: `lib/actions/admin.test.js`

**Interfaces:**
- Consumes: Task 1's `date_of_birth` column/trigger support.
- Produces: `bulkUploadStudents(prevState, formData)` → `Promise<{ ok: true, createdCount: number, failed: Array<{matric_number, reason}> } | { errors: object }>`. `inviteSchema`'s `role` enum narrowed to `['lecturer', 'school_admin']`; `inviteUser` no longer accepts or requires `matric_number`/`level`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/actions/admin.test.js` (append; also update the existing "requires a matric number when inviting a student" test, which no longer applies):

Remove this existing test block (student invites no longer exist):

```js
  it('requires a matric number when inviting a student', async () => {
    ...
  })
```

Add:

```js
describe('inviteUser role restriction', () => {
  it('rejects role=student — students are onboarded via bulkUploadStudents instead', async () => {
    const adminClient = createMockSupabaseClient()
    createAdminClient.mockReturnValue(adminClient)

    const result = await inviteUser(undefined, formData({
      email: 'student@example.com', full_name: 'A Student', role: 'student',
    }))

    expect(result.errors.role).toBeDefined()
    expect(adminClient.auth.admin.createUser).not.toHaveBeenCalled()
  })
})

describe('bulkUploadStudents', () => {
  it('rejects an empty roster without calling the admin client', async () => {
    const adminClient = createMockSupabaseClient()
    createAdminClient.mockReturnValue(adminClient)

    const result = await bulkUploadStudents(undefined, formData({ roster: '   \n  ' }))

    expect(result.errors._form).toBeDefined()
    expect(adminClient.auth.admin.createUser).not.toHaveBeenCalled()
  })

  it('creates one auth user per valid row with no password field, and reports invalid rows', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.createUser
      .mockResolvedValueOnce({ data: { user: { id: 'stu-1' } }, error: null })
    createAdminClient.mockReturnValue(adminClient)

    const roster = [
      'CSC/2021/001,Amina Bello,300,2003-04-12',
      'not,enough,fields',
    ].join('\n')

    const result = await bulkUploadStudents(undefined, formData({ roster }))

    expect(adminClient.auth.admin.createUser).toHaveBeenCalledTimes(1)
    const call = adminClient.auth.admin.createUser.mock.calls[0][0]
    expect(call.password).toBeUndefined()
    expect(call.email).toBe('csc2021001@uni-1.students.oems.internal')
    expect(call.user_metadata).toEqual({
      full_name: 'Amina Bello',
      role: 'student',
      university_id: 'uni-1',
      matric_number: 'CSC/2021/001',
      level: '300',
      date_of_birth: '2003-04-12',
    })
    expect(result.ok).toBe(true)
    expect(result.createdCount).toBe(1)
    expect(result.failed).toHaveLength(1)
  })

  it('tolerates a missing date_of_birth (nullable, backfilled later)', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.createUser
      .mockResolvedValueOnce({ data: { user: { id: 'stu-2' } }, error: null })
    createAdminClient.mockReturnValue(adminClient)

    const result = await bulkUploadStudents(undefined, formData({ roster: 'CSC/2021/002,Femi Ade,200' }))

    const call = adminClient.auth.admin.createUser.mock.calls[0][0]
    expect(call.user_metadata.date_of_birth).toBeNull()
    expect(result.createdCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- lib/actions/admin.test.js`
Expected: FAIL — `bulkUploadStudents` is not exported; `role: student` still succeeds.

- [ ] **Step 3: Update `inviteSchema` and `inviteUser`, add `bulkUploadStudents`**

In `lib/actions/admin.js`, replace the `inviteSchema` definition:

```js
const inviteSchema = z.object({
  email:         z.string().email('Valid email required'),
  full_name:     z.string().min(2, 'Full name required'),
  role:          z.enum(['lecturer', 'school_admin']),
  department_id: z.string().uuid().optional().or(z.literal('')),
  faculty_id:    z.string().uuid().optional().or(z.literal('')),
})
```

Replace the body of `inviteUser` (drop `matric_number`/`level` handling — students no longer go through this path):

```js
export async function inviteUser(prevState, formData) {
  const user = await requireRole('school_admin', 'super_admin')

  const raw = {
    email:         formData.get('email')?.trim(),
    full_name:     formData.get('full_name')?.trim(),
    role:          formData.get('role'),
    department_id: formData.get('department_id') || undefined,
    faculty_id:    formData.get('faculty_id') || undefined,
  }

  const parsed = inviteSchema.safeParse(raw)
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors }
  }

  const { email, full_name, role, department_id, faculty_id } = parsed.data

  const adminClient = createAdminClient()

  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password: 'ChangeMe123!',   // temporary password — user should reset via forgot-password
    email_confirm: true,
    user_metadata: {
      full_name,
      role,
      university_id: user.university_id,
      matric_number: null,
      level:         null,
    },
  })

  if (authError) {
    if (authError.message.includes('already registered')) {
      return { errors: { email: ['This email is already registered.'] } }
    }
    return { errors: { _form: authError.message } }
  }

  // Update department/faculty since the trigger doesn't set those
  if ((department_id || faculty_id) && authData.user?.id) {
    const supabase = await createClient()
    await supabase
      .from('users')
      .update({
        department_id: department_id || null,
        faculty_id:    faculty_id    || null,
      })
      .eq('id', authData.user.id)
  }

  revalidatePath('/admin/users')
  return { ok: true, email }
}

// ─── Bulk student roster upload ───────────────────────────────────────────────

const studentRowSchema = z.object({
  matric_number: z.string().min(1, 'Matric number required'),
  full_name:     z.string().min(2, 'Full name required'),
  level:         z.enum(['100', '200', '300', '400', '500', 'PG']),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD').optional().or(z.literal('')),
})

function parseRosterText(text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [matric_number, full_name, level, date_of_birth] = line.split(',').map(s => s?.trim())
      return { matric_number, full_name, level, date_of_birth }
    })
}

// Students never get a password — no `password` field is passed to
// createUser at all. They authenticate later via matric number + a
// per-exam access code (lib/actions/studentAuth.js), never via this email.
export async function bulkUploadStudents(prevState, formData) {
  const user         = await requireRole('school_admin', 'super_admin')
  const rosterText    = formData.get('roster') ?? ''
  const department_id = formData.get('department_id') || undefined
  const faculty_id     = formData.get('faculty_id') || undefined

  const rows = parseRosterText(rosterText)
  if (rows.length === 0) {
    return { errors: { _form: 'Paste at least one student row (matric number, full name, level).' } }
  }

  const adminClient = createAdminClient()
  const created = []
  const failed  = []

  for (const row of rows) {
    const parsed = studentRowSchema.safeParse(row)
    if (!parsed.success) {
      const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid row'
      failed.push({ matric_number: row.matric_number || '(blank)', reason: firstError })
      continue
    }

    const { matric_number, full_name, level, date_of_birth } = parsed.data
    const localPart = matric_number.toLowerCase().replace(/[^a-z0-9]/g, '')
    const email = `${localPart}@${user.university_id}.students.oems.internal`

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        full_name,
        role: 'student',
        university_id: user.university_id,
        matric_number,
        level,
        date_of_birth: date_of_birth || null,
      },
    })

    if (authError) {
      failed.push({
        matric_number,
        reason: authError.message.includes('already registered') ? 'Already registered' : authError.message,
      })
      continue
    }

    if ((department_id || faculty_id) && authData.user?.id) {
      const supabase = await createClient()
      await supabase
        .from('users')
        .update({ department_id: department_id || null, faculty_id: faculty_id || null })
        .eq('id', authData.user.id)
    }

    created.push(matric_number)
  }

  revalidatePath('/admin/users')
  return { ok: true, createdCount: created.length, failed }
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm test -- lib/actions/admin.test.js`
Expected: PASS. Note the "creates the user with a temporary password" test for `inviteUser` (lecturer role) still passes unchanged — that flow is untouched for staff.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: all PASS.

```bash
git add lib/actions/admin.js lib/actions/admin.test.js
git commit -m "feat: add bulkUploadStudents, remove student role from inviteUser"
```

---

### Task 6: Bulk roster upload UI

**Files:**
- Create: `app/admin/users/BulkUploadStudentsModal.js`
- Modify: `app/admin/users/InviteUserModal.js`
- Modify: `app/admin/users/page.js`

**Interfaces:**
- Consumes: Task 5's `bulkUploadStudents` and updated `inviteUser`.
- Produces: `BulkUploadStudentsModal` component (same props shape as `InviteUserModal`: `{ faculties, departments }`).

- [ ] **Step 1: Remove the student role from `InviteUserModal`**

In `app/admin/users/InviteUserModal.js`:
- Change the default `role` state from `'lecturer'` (already is) and remove the `'student'` `<option>` from the role `<select>`.
- Remove the entire `{role === 'student' && (...)}` block (matric number + level fields).
- Update the role select's remaining options to just Lecturer and Exam Officer:

```jsx
                <select
                  name="role"
                  value={role}
                  onChange={e => setRole(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                >
                  <option value="lecturer">Lecturer</option>
                  <option value="school_admin">Exam Officer</option>
                </select>
```

- [ ] **Step 2: Create `BulkUploadStudentsModal.js`**

```jsx
'use client'

import { useActionState, useState, useEffect } from 'react'
import { X, Users } from 'lucide-react'
import { bulkUploadStudents } from '@/lib/actions/admin'
import { Select } from '@/components/ui/Select'
import { SubmitButton } from '@/components/ui/Button'

export function BulkUploadStudentsModal({ faculties, departments }) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(bulkUploadStudents, null)

  useEffect(() => {
    if (state?.ok && state.failed.length === 0) {
      setOpen(false)
    }
  }, [state])

  const deptOptions = departments.map(d => ({ value: d.id, label: `${d.name} (${d.faculties?.name ?? ''})` }))

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 border border-border text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
      >
        <Users size={15} />
        Upload Student Roster
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-text-primary">Upload Student Roster</h2>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded text-text-muted hover:text-text-primary">
                <X size={16} />
              </button>
            </div>

            <form action={formAction} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">
                  Roster — one student per line
                </label>
                <textarea
                  name="roster"
                  rows={8}
                  required
                  placeholder="CSC/2021/001,Amina Bello,300,2003-04-12&#10;CSC/2021/002,Femi Ade,200"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <p className="text-xs text-text-muted mt-1.5">
                  Format: matric number, full name, level, date of birth (YYYY-MM-DD, optional).
                  No password is created — students sign in with their matric number and an
                  exam access code.
                </p>
                {state?.errors?._form && (
                  <p className="text-sm text-danger mt-1.5">{state.errors._form}</p>
                )}
              </div>

              {deptOptions.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1.5">Department <span className="text-text-muted font-normal">(optional, applies to all rows)</span></label>
                  <select name="department_id" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary">
                    <option value="">— Select department —</option>
                    {deptOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}

              {state?.ok && (
                <div className="text-xs bg-page rounded-lg px-3 py-2 space-y-1">
                  <p className="text-success font-medium">{state.createdCount} student(s) created.</p>
                  {state.failed.length > 0 && (
                    <ul className="text-danger">
                      {state.failed.map((f, i) => (
                        <li key={i}>{f.matric_number}: {f.reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <SubmitButton className="flex-1" loadingText="Uploading…">Upload Roster</SubmitButton>
                <button type="button" onClick={() => setOpen(false)} className="flex-1 py-2.5 border border-border text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors">
                  Close
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 3: Wire it into the admin users page**

In `app/admin/users/page.js`, import and render both modals in the `TopBar` actions:

```jsx
import { InviteUserModal } from './InviteUserModal'
import { BulkUploadStudentsModal } from './BulkUploadStudentsModal'
```

```jsx
        actions={
          <div className="flex items-center gap-2">
            <BulkUploadStudentsModal
              faculties={faculties ?? []}
              departments={departments ?? []}
            />
            <InviteUserModal
              faculties={faculties ?? []}
              departments={departments ?? []}
            />
          </div>
        }
```

- [ ] **Step 4: Manually verify in the dev server**

Run: `npm run dev`. As a school_admin, open `/admin/users`, confirm the role dropdown in "Invite User" no longer offers Student, and confirm "Upload Student Roster" creates students from a pasted multi-line roster and reports any invalid rows.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: PASS (no logic changed here that tests cover — this step confirms the earlier refactor didn't regress).

```bash
git add app/admin/users/BulkUploadStudentsModal.js app/admin/users/InviteUserModal.js app/admin/users/page.js
git commit -m "feat: add bulk student roster upload UI, remove student option from invite modal"
```

---

### Task 7: Verification Server Actions with rate limiting

**Files:**
- Create: `lib/actions/studentAuth.js`
- Test: `lib/actions/studentAuth.test.js`

**Interfaces:**
- Consumes: Task 1's `verification_attempts` table and `exams.access_code`, Task 4's `mintStudentSession`.
- Produces: `verifyExamAccess(prevState, formData)` and `verifyResultAccess(prevState, formData)`, both `Promise<{ error: string } | never>` (redirect on success, to `/lab/{access_code}` and `/student/results` respectively). Consumed by Tasks 8 and 9's UI.

- [ ] **Step 1: Write the failing tests**

Create `lib/actions/studentAuth.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/studentSession', () => ({ mintStudentSession: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('REDIRECT') }) }))
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Map([['x-forwarded-for', '203.0.113.1']])),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { mintStudentSession } from '@/lib/supabase/studentSession'
import { redirect } from 'next/navigation'
import { verifyExamAccess, verifyResultAccess } from './studentAuth'

function formData(fields) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

const GENERIC = { error: 'Check your details and try again.' }

beforeEach(() => vi.clearAllMocks())

describe('verifyExamAccess', () => {
  it('rejects an unknown access code without leaking which field was wrong', async () => {
    // Two verification_attempts responses queued: one for the rate-limit
    // count check, one for the recordFailedAttempt insert that follows.
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      exams: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))

    expect(result).toEqual(GENERIC)
    expect(mintStudentSession).not.toHaveBeenCalled()
  })

  it('mints a session and redirects when matric number and access code both match a live exam', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }],
      exams: [{ data: { id: 'exam-1', university_id: 'uni-1', status: 'live' }, error: null }],
      users: [{ data: { id: 'stu-1', email: 'csc2021001@uni-1.students.oems.internal', is_active: true }, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)
    mintStudentSession.mockResolvedValue({ ok: true })

    await expect(
      verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'abc123' }))
    ).rejects.toThrow('REDIRECT')

    expect(mintStudentSession).toHaveBeenCalledWith('csc2021001@uni-1.students.oems.internal')
    expect(redirect).toHaveBeenCalledWith('/lab/ABC123')
  })

  it('blocks after too many failed attempts from the same matric number + IP', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 5 }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))

    expect(result).toEqual(GENERIC)
    expect(adminClient.from).not.toHaveBeenCalledWith('exams')
  })
})

describe('verifyResultAccess', () => {
  it('rejects when matric number + date of birth match zero students', async () => {
    // Two verification_attempts responses queued: rate-limit check + the
    // recordFailedAttempt insert that follows a zero-match result.
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      users: [{ data: [], error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyResultAccess(undefined, formData({ matric_number: 'CSC/2021/001', date_of_birth: '2003-04-12' }))

    expect(result).toEqual(GENERIC)
  })

  it('rejects when matric number + date of birth match more than one student (cross-university collision)', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      users: [{ data: [{ id: 'a', email: 'a@x', is_active: true }, { id: 'b', email: 'b@x', is_active: true }], error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyResultAccess(undefined, formData({ matric_number: 'CSC/2021/001', date_of_birth: '2003-04-12' }))

    expect(result).toEqual(GENERIC)
    expect(mintStudentSession).not.toHaveBeenCalled()
  })

  it('mints a session and redirects to /student/results on exactly one match', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }],
      users: [{ data: [{ id: 'a', email: 'a@uni-1.students.oems.internal', is_active: true }], error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)
    mintStudentSession.mockResolvedValue({ ok: true })

    await expect(
      verifyResultAccess(undefined, formData({ matric_number: 'CSC/2021/001', date_of_birth: '2003-04-12' }))
    ).rejects.toThrow('REDIRECT')

    expect(mintStudentSession).toHaveBeenCalledWith('a@uni-1.students.oems.internal')
    expect(redirect).toHaveBeenCalledWith('/student/results')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- lib/actions/studentAuth.test.js`
Expected: FAIL — `./studentAuth` doesn't exist.

- [ ] **Step 3: Implement `lib/actions/studentAuth.js`**

```js
'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { mintStudentSession } from '@/lib/supabase/studentSession'

const RATE_LIMIT_WINDOW_MINUTES = 15
const RATE_LIMIT_MAX_ATTEMPTS   = 5

const GENERIC_ERROR = { error: 'Check your details and try again.' }

async function getClientIp() {
  const hdrs = await headers()
  return hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

async function isRateLimited(adminClient, matricNumber, ip) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count } = await adminClient
    .from('verification_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('matric_number', matricNumber)
    .eq('ip', ip)
    .gte('created_at', since)
  return (count ?? 0) >= RATE_LIMIT_MAX_ATTEMPTS
}

async function recordFailedAttempt(adminClient, matricNumber, ip) {
  await adminClient.from('verification_attempts').insert({ matric_number: matricNumber, ip })
}

// ─── Enter exam: matric number + per-exam access code ─────────────────────────

const examAccessSchema = z.object({
  matric_number: z.string().min(1),
  access_code:   z.string().length(6),
})

export async function verifyExamAccess(prevState, formData) {
  const parsed = examAccessSchema.safeParse({
    matric_number: formData.get('matric_number')?.trim(),
    access_code:   formData.get('access_code')?.trim().toUpperCase(),
  })
  if (!parsed.success) return GENERIC_ERROR

  const { matric_number, access_code } = parsed.data
  const ip = await getClientIp()
  const adminClient = createAdminClient()

  if (await isRateLimited(adminClient, matric_number, ip)) return GENERIC_ERROR

  const { data: exam } = await adminClient
    .from('exams')
    .select('id, university_id, status')
    .eq('access_code', access_code)
    .maybeSingle()

  if (!exam || exam.status !== 'live') {
    await recordFailedAttempt(adminClient, matric_number, ip)
    return GENERIC_ERROR
  }

  const { data: student } = await adminClient
    .from('users')
    .select('id, email, is_active')
    .eq('role', 'student')
    .eq('university_id', exam.university_id)
    .eq('matric_number', matric_number)
    .maybeSingle()

  if (!student || !student.is_active) {
    await recordFailedAttempt(adminClient, matric_number, ip)
    return GENERIC_ERROR
  }

  const session = await mintStudentSession(student.email)
  if (session.error) return GENERIC_ERROR

  redirect(`/lab/${access_code}`)
}

// ─── Check result: matric number + date of birth ───────────────────────────────

const resultAccessSchema = z.object({
  matric_number: z.string().min(1),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function verifyResultAccess(prevState, formData) {
  const parsed = resultAccessSchema.safeParse({
    matric_number: formData.get('matric_number')?.trim(),
    date_of_birth: formData.get('date_of_birth'),
  })
  if (!parsed.success) return GENERIC_ERROR

  const { matric_number, date_of_birth } = parsed.data
  const ip = await getClientIp()
  const adminClient = createAdminClient()

  if (await isRateLimited(adminClient, matric_number, ip)) return GENERIC_ERROR

  // No university scoping here — matric numbers are only unique per
  // university, so a cross-university match is treated as ambiguous and
  // rejected the same as no match. See Global Constraints in the plan.
  const { data: students } = await adminClient
    .from('users')
    .select('id, email, is_active')
    .eq('role', 'student')
    .eq('matric_number', matric_number)
    .eq('date_of_birth', date_of_birth)

  if (!students || students.length !== 1 || !students[0].is_active) {
    await recordFailedAttempt(adminClient, matric_number, ip)
    return GENERIC_ERROR
  }

  const session = await mintStudentSession(students[0].email)
  if (session.error) return GENERIC_ERROR

  redirect('/student/results')
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm test -- lib/actions/studentAuth.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: all PASS.

```bash
git add lib/actions/studentAuth.js lib/actions/studentAuth.test.js
git commit -m "feat: add verifyExamAccess and verifyResultAccess with rate limiting"
```

---

### Task 8: Exam-entry UI — matric number + access code

**Files:**
- Modify: `app/lab/LabCodeEntry.js`
- Modify: `app/lab/page.js`
- Modify: `proxy.js`

**Interfaces:**
- Consumes: Task 7's `verifyExamAccess`.
- Produces: `/lab` is reachable without a session; `/lab/[code]` and deeper remain session-protected.

- [ ] **Step 1: Rewrite `LabCodeEntry.js` to collect matric number and call the Server Action**

```jsx
'use client'

import { useActionState, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { verifyExamAccess } from '@/lib/actions/studentAuth'

export function LabCodeEntry() {
  const [state, formAction, pending] = useActionState(verifyExamAccess, null)
  const [code, setCode] = useState('')

  function handleCodeChange(e) {
    setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
  }

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label htmlFor="matric_number" className="block text-sm font-medium text-text-primary mb-2">
          Matric Number
        </label>
        <input
          id="matric_number"
          name="matric_number"
          type="text"
          placeholder="e.g. CSC/2021/001"
          autoComplete="off"
          required
          className="w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-sm focus:outline-none focus:border-primary transition-colors"
        />
      </div>

      <div>
        <label htmlFor="access_code" className="block text-sm font-medium text-text-primary mb-2 text-center">
          Access Code
        </label>
        <input
          id="access_code"
          name="access_code"
          type="text"
          value={code}
          onChange={handleCodeChange}
          placeholder="e.g. ABC123"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          className={[
            'w-full text-center text-3xl font-mono font-bold tracking-[0.35em] uppercase',
            'rounded-2xl border-2 bg-surface px-4 py-5 focus:outline-none transition-colors',
            state?.error
              ? 'border-danger text-danger'
              : 'border-border focus:border-primary text-text-primary',
          ].join(' ')}
          maxLength={6}
        />
        {state?.error && (
          <p className="text-xs text-danger mt-2 text-center">{state.error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={code.length !== 6 || pending}
        className="w-full flex items-center justify-center gap-2 py-3.5 bg-primary text-white text-sm font-semibold rounded-2xl hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending
          ? <><Loader2 size={16} className="animate-spin" /> Verifying…</>
          : <><ArrowRight size={16} /> Enter Exam</>
        }
      </button>

      <p className="text-center text-xs text-text-muted">
        The access code is shared by your lecturer or exam officer.
      </p>
    </form>
  )
}
```

- [ ] **Step 2: Update the page copy in `app/lab/page.js`**

Change the subtitle text (line 18) from "Enter the lab code displayed by your lecturer" to "Enter your matric number and the exam access code" — and update `metadata.title` from `'Enter Lab Code — OEMS'` to `'Enter Exam — OEMS'`.

- [ ] **Step 3: Make `/lab` reachable without a session, without exposing `/lab/[code]`**

In `proxy.js`, split the public-path check into a prefix-matched list (unchanged behavior) and a new exact-match-only list, so `/lab` itself is public but `/lab/ABC123` and deeper stay session-protected:

```js
const PUBLIC_PATHS = ['/login', '/forgot-password', '/dev']
const EXACT_PUBLIC_PATHS = ['/lab']
```

```js
  const isPublicPath =
    PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/')) ||
    EXACT_PUBLIC_PATHS.includes(pathname)
```

- [ ] **Step 4: Manually verify the full flow in the dev server**

Run: `npm run dev`. In a private/incognito window (no session):
1. Visit `/lab/ABC123` directly (using a real live exam's code) — confirm it redirects to `/login` (still protected — the exact-match list didn't leak the subpath).
2. Visit `/lab` — confirm it loads without redirecting to `/login`.
3. Enter a valid matric number + access code for a live exam — confirm it lands on the exam lobby (`/lab/{code}`) and the exam can be started.
4. Enter an invalid matric number or code — confirm the generic error shows, and no information about which field was wrong is revealed.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: all PASS (no test coverage for `proxy.js`/manual UI changes — consistent with the existing constraint that this round has no component/DOM/middleware test coverage).

```bash
git add app/lab/LabCodeEntry.js app/lab/page.js proxy.js
git commit -m "feat: wire matric number + access code entry into /lab, make it session-less"
```

---

### Task 9: Result-lookup UI — matric number + date of birth

**Files:**
- Create: `app/check-result/layout.js`
- Create: `app/check-result/page.js`
- Create: `app/check-result/CheckResultForm.js`
- Modify: `proxy.js`

**Interfaces:**
- Consumes: Task 7's `verifyResultAccess`.
- Produces: `/check-result` is reachable without a session and redirects into the existing, unmodified `/student/results` page on success.

- [ ] **Step 1: Add the kiosk-style layout (mirrors `app/lab/layout.js`)**

```jsx
// Kiosk layout — no sidebar, no navigation. Used for unauthenticated result lookup.
export default function CheckResultLayout({ children }) {
  return (
    <div className="min-h-screen bg-page flex flex-col">
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Add the page shell (mirrors `app/lab/page.js`)**

```jsx
import { CheckResultForm } from './CheckResultForm'

export const metadata = { title: 'Check Result — OEMS' }

export default function CheckResultPage() {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-primary text-white text-2xl font-bold mb-4">
            O
          </div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Check Your Result</h1>
          <p className="text-sm text-text-muted mt-1">
            Enter your matric number and date of birth
          </p>
        </div>

        <CheckResultForm />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add the form component**

```jsx
'use client'

import { useActionState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { verifyResultAccess } from '@/lib/actions/studentAuth'

export function CheckResultForm() {
  const [state, formAction, pending] = useActionState(verifyResultAccess, null)

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label htmlFor="matric_number" className="block text-sm font-medium text-text-primary mb-2">
          Matric Number
        </label>
        <input
          id="matric_number"
          name="matric_number"
          type="text"
          placeholder="e.g. CSC/2021/001"
          autoComplete="off"
          required
          className="w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-sm focus:outline-none focus:border-primary transition-colors"
        />
      </div>

      <div>
        <label htmlFor="date_of_birth" className="block text-sm font-medium text-text-primary mb-2">
          Date of Birth
        </label>
        <input
          id="date_of_birth"
          name="date_of_birth"
          type="date"
          required
          className="w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-sm focus:outline-none focus:border-primary transition-colors"
        />
        {state?.error && (
          <p className="text-xs text-danger mt-2 text-center">{state.error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full flex items-center justify-center gap-2 py-3.5 bg-primary text-white text-sm font-semibold rounded-2xl hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending
          ? <><Loader2 size={16} className="animate-spin" /> Checking…</>
          : <><ArrowRight size={16} /> View My Results</>
        }
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Add `/check-result` to the public paths in `proxy.js`**

```js
const EXACT_PUBLIC_PATHS = ['/lab', '/check-result']
```

- [ ] **Step 5: Manually verify in the dev server**

Run: `npm run dev`. In a private/incognito window: visit `/check-result`, submit a known student's matric number + date of birth (set via Task 5's roster upload), confirm it lands on `/student/results` showing their released results. Submit a wrong date of birth, confirm the generic error shows.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test`
Expected: all PASS.

```bash
git add app/check-result/layout.js app/check-result/page.js app/check-result/CheckResultForm.js proxy.js
git commit -m "feat: add matric number + date of birth result lookup at /check-result"
```

---

## Self-review notes

- **Spec coverage:** bulk roster provisioning (Task 5–6), passwordless session minting (Task 4), matric+access_code exam entry (Task 3, 7, 8), matric+DOB result check (Task 7, 9), access_code generalized to remote exams (Task 3), single-purpose session scope (Tasks 8–9 redirect directly into the one exam/result, no dashboard links added), session hygiene / sign-out-before-mint (Task 4), rate limiting (Task 7), generic error messages (Task 7) — all covered. Staff auth and multi-tenancy resolution are explicitly out of scope per the spec's Non-goals and this plan's Global Constraints.
- **Type/name consistency checked:** `generateAccessCode`/`access_code` (Task 3) matches usage in Tasks 7–8; `mintStudentSession(email)` signature (Task 4) matches its two call sites in Task 7; `AccessCodePanel`/`accessCode` prop name (Task 3) is self-contained to that task.
