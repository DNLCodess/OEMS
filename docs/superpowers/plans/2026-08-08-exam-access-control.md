# Exam Access Control Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind a credential-less student's exam-access session to the specific exam it was verified for, and give lecturers a working UI to restrict which students may take a given exam.

**Architecture:** Extend the existing `app_metadata`-based session tagging (added in the credential-less-auth work) with a `verified_exam_id` field, checked only at attempt-creation time. Build two new server actions plus one new UI panel on top of the `exam_access` table and its RLS policies, which already exist and are already enforced — this is a pure application-layer feature, no schema change.

**Tech Stack:** Next.js 16 Server Actions, Supabase JS client, Vitest with the shared `tests/helpers/supabaseMock.js` chainable mock.

## Global Constraints

- `saveAnswer` and `submitExam` in `lib/actions/attempts.js` are NOT changed — only `startExam` gains the exam-id check. (spec: Session-exam binding)
- The allow-list candidate pool is **not** filtered by department or level — searches all active students in the lecturer's own university, to support students retaking a course at a different level than its nominal one. (spec: Non-goals)
- Zero rows in `exam_access` for an exam means "open to all" — this is existing RLS behavior (`supabase/schema.sql`'s `student_read_accessible_exams` policy), not something this plan changes. The UI must make this state explicit, not just show an empty list. (spec: Lecturer allow-list UI)
- No migration or schema change — `exam_access` and its RLS policies already exist. (spec: Problem)
- A duplicate "add" (student already in the allow-list) is a no-op success, not a surfaced error. (spec: Lecturer allow-list UI)

---

### Task 1: Bind session-minting to a specific exam

**Files:**
- Modify: `lib/supabase/studentSession.js` (the whole `mintStudentSession` function, currently lines 20-55)
- Modify: `lib/actions/studentAuth.js:90` (the `mintStudentSession` call inside `verifyExamAccess`)
- Modify: `tests/helpers/supabaseMock.js:43-46` (add `updateUserById` to the shared mock's `admin` object)
- Test: `lib/supabase/studentSession.test.js`

**Interfaces:**
- Produces: `mintStudentSession(email, channel, examId = null)` — when `examId` is provided, the minted session's `app_metadata` includes `verified_exam_id: examId` alongside the existing `session_channel`. When omitted, behavior is unchanged from today (only `session_channel` is set). Return shape (`{ ok: true }` or `{ error: string }`) is unchanged.

- [ ] **Step 1: Add `updateUserById` to the shared Supabase mock**

`tests/helpers/supabaseMock.js` currently only stubs `createUser` and `generateLink` on `auth.admin`, so every test file that needs `updateUserById` (currently just `studentSession.test.js`) monkey-patches it by hand. Add it to the shared mock so that stops being necessary.

Open `tests/helpers/supabaseMock.js` and change the `admin` block (lines 43-46) from:

```js
      admin: {
        createUser: vi.fn(),
        generateLink: vi.fn(),
      },
```

to:

```js
      admin: {
        createUser: vi.fn(),
        generateLink: vi.fn(),
        updateUserById: vi.fn(),
      },
```

- [ ] **Step 2: Simplify `studentSession.test.js`'s mock helper now that the shared mock provides `updateUserById`**

Open `lib/supabase/studentSession.test.js`. Replace the `mockAdminClient` helper (lines 13-23):

```js
function mockAdminClient({ generateLink, updateUserById } = {}) {
  const adminClient = createMockSupabaseClient()
  adminClient.auth.admin.generateLink.mockResolvedValue(
    generateLink ?? {
      data: { user: { id: 'user-1' }, properties: { hashed_token: 'tok_123' } },
      error: null,
    }
  )
  adminClient.auth.admin.updateUserById = vi.fn().mockResolvedValue(updateUserById ?? { data: {}, error: null })
  return adminClient
}
```

with:

```js
function mockAdminClient({ generateLink, updateUserById } = {}) {
  const adminClient = createMockSupabaseClient()
  adminClient.auth.admin.generateLink.mockResolvedValue(
    generateLink ?? {
      data: { user: { id: 'user-1' }, properties: { hashed_token: 'tok_123' } },
      error: null,
    }
  )
  adminClient.auth.admin.updateUserById.mockResolvedValue(updateUserById ?? { data: {}, error: null })
  return adminClient
}
```

- [ ] **Step 3: Write the failing test for exam-bound session minting**

In `lib/supabase/studentSession.test.js`, add a new test inside the `describe('mintStudentSession', ...)` block (after the existing `'records session_channel: result_lookup...'` test):

```js
  it('also records verified_exam_id in app_metadata when an examId is passed', async () => {
    const adminClient = mockAdminClient()
    createAdminClient.mockReturnValue(adminClient)

    const serverClient = createMockSupabaseClient()
    serverClient.auth.verifyOtp.mockResolvedValue({ data: {}, error: null })
    createClient.mockResolvedValue(serverClient)

    await mintStudentSession('matric-1@uni-1.students.oems.internal', 'exam_access', 'exam-1')

    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith('user-1', {
      app_metadata: { session_channel: 'exam_access', verified_exam_id: 'exam-1' },
    })
  })

  it('omits verified_exam_id from app_metadata when no examId is passed (result_lookup sessions)', async () => {
    const adminClient = mockAdminClient()
    createAdminClient.mockReturnValue(adminClient)

    const serverClient = createMockSupabaseClient()
    serverClient.auth.verifyOtp.mockResolvedValue({ data: {}, error: null })
    createClient.mockResolvedValue(serverClient)

    await mintStudentSession('matric-1@uni-1.students.oems.internal', 'result_lookup')

    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith('user-1', {
      app_metadata: { session_channel: 'result_lookup' },
    })
  })
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run lib/supabase/studentSession.test.js`
Expected: the first new test FAILs — `updateUserById` was called with `{ app_metadata: { session_channel: 'exam_access' } }` (no `verified_exam_id`), not matching the new expectation. The second new test passes already (current behavior already omits it when there's nothing to add) — that's fine, it's a regression guard for the next step.

- [ ] **Step 5: Implement exam-id binding in `mintStudentSession`**

Open `lib/supabase/studentSession.js`. Replace the whole file with:

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
 *
 * `channel` records which verification path was used to mint this session
 * ('exam_access' or 'result_lookup') so downstream actions can refuse to
 * treat a result-lookup session as good enough to sit an exam. It's stored
 * in the auth user's `app_metadata` — settable only via the admin API,
 * never by the browser — and read back later with a live `getUser()` call,
 * so it can't be spoofed the way a client-writable cookie could be.
 *
 * `examId`, when provided (only for the 'exam_access' channel), is stored
 * alongside the channel as `verified_exam_id`. This binds the session to
 * the one exam whose access code was actually entered — without it, any
 * exam-access-channel session could be used to start ANY live exam in the
 * student's university, not just the one they verified for.
 */
export async function mintStudentSession(email, channel, examId = null) {
  const adminClient = createAdminClient()

  const { data, error } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  if (error || !data?.properties?.hashed_token) {
    return GENERIC_SESSION_ERROR
  }

  const appMetadata = examId
    ? { session_channel: channel, verified_exam_id: examId }
    : { session_channel: channel }

  const { error: metadataError } = await adminClient.auth.admin.updateUserById(data.user.id, {
    app_metadata: appMetadata,
  })

  if (metadataError) {
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

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run lib/supabase/studentSession.test.js`
Expected: all tests PASS (7 total: the 5 pre-existing plus the 2 added in Step 3).

- [ ] **Step 7: Pass the exam id from `verifyExamAccess`**

Open `lib/actions/studentAuth.js`. On line 90, change:

```js
  const session = await mintStudentSession(student.email, 'exam_access')
```

to:

```js
  const session = await mintStudentSession(student.email, 'exam_access', exam.id)
```

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: all tests PASS (no `studentAuth.test.js` changes needed here — it doesn't assert on `mintStudentSession`'s call arguments today, only on its return value).

- [ ] **Step 9: Commit**

```bash
git add lib/supabase/studentSession.js lib/supabase/studentSession.test.js lib/actions/studentAuth.js tests/helpers/supabaseMock.js
git commit -m "feat: bind exam-access sessions to the specific exam they were verified for"
```

---

### Task 2: Enforce the exam-id binding in `startExam`

**Files:**
- Modify: `lib/actions/attempts.js:10-20` (add a new check function, used only by `startExam`)
- Test: `lib/actions/attempts.test.js`

**Interfaces:**
- Consumes: `authUser.app_metadata.verified_exam_id`, set by Task 1's `mintStudentSession`.
- Produces: `startExam(examId)` now rejects with the existing `EXAM_ACCESS_REQUIRED_ERROR` when the session's `verified_exam_id` doesn't match `examId`, in addition to the existing wrong-channel and missing-metadata rejections. `saveAnswer` and `submitExam` are unchanged.

- [ ] **Step 1: Write the failing test for exam-id mismatch**

Open `lib/actions/attempts.test.js`. Replace the `authUserWith` helper (lines 29-31):

```js
function authUserWith(sessionChannel) {
  return { data: { user: { app_metadata: { session_channel: sessionChannel } } } }
}
```

with a version that also accepts an exam id:

```js
function authUserWith(sessionChannel, examId) {
  return { data: { user: { app_metadata: { session_channel: sessionChannel, verified_exam_id: examId } } } }
}
```

Then update the `startExam` happy-path test (the `'proceeds normally for an exam-access-channel session (happy path preserved)'` test, around line 40-54) so it binds to the exam it's actually starting — change:

```js
    supabase.auth.getUser.mockResolvedValue(authUserWith('exam_access'))
```

to:

```js
    supabase.auth.getUser.mockResolvedValue(authUserWith('exam_access', 'exam-1'))
```

(this one line, inside the `describe('startExam', ...)` block's first `it`).

Then add a new test inside `describe('startExam', ...)`, after the existing `'rejects a session with missing/undefined app_metadata...'` test:

```js
  it('rejects an exam-access session verified for a DIFFERENT exam, without touching the attempts table', async () => {
    const supabase = createMockSupabaseClient()
    supabase.auth.getUser.mockResolvedValue(authUserWith('exam_access', 'exam-2'))
    createClient.mockResolvedValue(supabase)

    const result = await startExam('exam-1')

    expect(result).toEqual(EXAM_ACCESS_REQUIRED)
    expect(supabase.from).not.toHaveBeenCalledWith('attempts')
    expect(supabase.from).not.toHaveBeenCalledWith('exams')
  })
```

Leave `saveAnswer` and `submitExam`'s tests untouched — they call `authUserWith('exam_access')` with no second argument, which now produces `verified_exam_id: undefined`; that's fine, since those two actions don't check it.

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `npx vitest run lib/actions/attempts.test.js`
Expected: the new "rejects... DIFFERENT exam" test FAILs — today's `hasExamAccessChannel` only checks the channel, so a session bound to `'exam-2'` is currently accepted for starting `'exam-1'`.

- [ ] **Step 3: Implement the exam-id check**

Open `lib/actions/attempts.js`. Replace the `hasExamAccessChannel` function and its comment (lines 7-20):

```js
const EXAM_ACCESS_REQUIRED_ERROR = {
  error: 'Please enter this exam using your matric number and access code.',
}

// A result-lookup session (matric number + date of birth) must never be
// able to start, save answers to, or submit an exam attempt — only a
// session minted via the exam-access channel (matric number + access code)
// may take exams. `session_channel` lives in the auth user's app_metadata,
// which only the admin API can set (never the browser), and we re-fetch it
// with a live getUser() call (not getSession(), which trusts a locally
// decoded JWT) so nothing client-controlled can flip this check.
function hasExamAccessChannel(authUser) {
  return authUser?.app_metadata?.session_channel === 'exam_access'
}
```

with:

```js
const EXAM_ACCESS_REQUIRED_ERROR = {
  error: 'Please enter this exam using your matric number and access code.',
}

// A result-lookup session (matric number + date of birth) must never be
// able to start, save answers to, or submit an exam attempt — only a
// session minted via the exam-access channel (matric number + access code)
// may take exams. `session_channel` lives in the auth user's app_metadata,
// which only the admin API can set (never the browser), and we re-fetch it
// with a live getUser() call (not getSession(), which trusts a locally
// decoded JWT) so nothing client-controlled can flip this check.
function hasExamAccessChannel(authUser) {
  return authUser?.app_metadata?.session_channel === 'exam_access'
}

// startExam additionally requires the session to have been verified
// against THIS specific exam (see mintStudentSession's verified_exam_id).
// Without this, any exam-access-channel session — verified for some other
// live exam — could be used to start an exam whose access code was never
// entered. saveAnswer/submitExam don't need this check: by the time an
// attempt row exists, it was only created through this gate, and ownership
// is separately enforced by attempts.student_id = auth.uid().
function hasExamAccessFor(authUser, examId) {
  return hasExamAccessChannel(authUser) && authUser?.app_metadata?.verified_exam_id === examId
}
```

Then, in `startExam`, change:

```js
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!hasExamAccessChannel(authUser)) return EXAM_ACCESS_REQUIRED_ERROR
```

to:

```js
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!hasExamAccessFor(authUser, examId)) return EXAM_ACCESS_REQUIRED_ERROR
```

Leave `saveAnswer` and `submitExam`'s own `if (!hasExamAccessChannel(authUser)) return EXAM_ACCESS_REQUIRED_ERROR` checks exactly as they are.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/actions/attempts.test.js`
Expected: all tests PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/attempts.js lib/actions/attempts.test.js
git commit -m "fix: require an exam-access session to be bound to the specific exam it starts"
```

---

### Task 3: Lecturer server actions for the exam allow-list

**Files:**
- Modify: `lib/actions/exams.js` (add three new exported functions)
- Modify: `tests/helpers/supabaseMock.js:3` (add `or` and `limit` to `CHAIN_METHODS`)
- Test: `lib/actions/exams.test.js`

**Interfaces:**
- Consumes: `getOwnedExam(supabase, examId, userId, universityId)` (existing helper, `lib/actions/exams.js`, returns the exam row or `null` if not owned).
- Produces:
  - `searchEligibleStudents(examId, query)` → `{ students: [{ id, full_name, matric_number, added }] }` or `{ error: string }`. `added` is `true` if the student is already in this exam's `exam_access` list. Returns `{ students: [] }` immediately, without querying, when the trimmed query is shorter than 2 characters.
  - `addExamAccessStudent(examId, studentId)` → `{ ok: true }` or `{ error: string }`. A duplicate add (student already listed) is treated as success.
  - `removeExamAccessStudent(examId, studentId)` → `{ ok: true }` or `{ error: string }`.

- [ ] **Step 1: Extend the shared Supabase mock with `or` and `limit`**

`searchEligibleStudents` will chain `.or(...)` and `.limit(...)`, which the mock doesn't support yet. Open `tests/helpers/supabaseMock.js` and change line 3 from:

```js
const CHAIN_METHODS = ['select', 'eq', 'in', 'order', 'single', 'maybeSingle', 'gte', 'update', 'insert', 'upsert', 'delete']
```

to:

```js
const CHAIN_METHODS = ['select', 'eq', 'in', 'or', 'limit', 'order', 'single', 'maybeSingle', 'gte', 'update', 'insert', 'upsert', 'delete']
```

- [ ] **Step 2: Write the failing tests**

Open `lib/actions/exams.test.js`. Add these `describe` blocks after the existing `describe('generateAccessCode', ...)` block:

```js
describe('searchEligibleStudents', () => {
  it('returns an error when the exam is not owned by this lecturer', async () => {
    const supabase = createMockSupabaseClient({ exams: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await searchEligibleStudents('exam-1', 'amina')

    expect(result).toEqual({ error: 'Exam not found.' })
  })

  it('returns an empty list without querying when the query is shorter than 2 characters', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await searchEligibleStudents('exam-1', 'a')

    expect(result).toEqual({ students: [] })
    expect(supabase.from).not.toHaveBeenCalledWith('users')
  })

  it('searches active students in the lecturer\'s own university and flags existing allow-list members', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      users: [{
        data: [
          { id: 'stu-1', full_name: 'Amina Bello', matric_number: 'CSC/2021/001' },
          { id: 'stu-2', full_name: 'Amina Yusuf', matric_number: 'CSC/2021/002' },
        ],
        error: null,
      }],
      exam_access: [{ data: [{ user_id: 'stu-2' }], error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await searchEligibleStudents('exam-1', 'amina')

    expect(result).toEqual({
      students: [
        { id: 'stu-1', full_name: 'Amina Bello', matric_number: 'CSC/2021/001', added: false },
        { id: 'stu-2', full_name: 'Amina Yusuf', matric_number: 'CSC/2021/002', added: true },
      ],
    })
    const usersBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'users').value
    expect(usersBuilder.eq).toHaveBeenCalledWith('university_id', 'uni-1')
    expect(usersBuilder.eq).toHaveBeenCalledWith('role', 'student')
    expect(usersBuilder.eq).toHaveBeenCalledWith('is_active', true)
    expect(usersBuilder.or).toHaveBeenCalledWith('matric_number.ilike.%amina%,full_name.ilike.%amina%')
  })

  it('strips comma and parenthesis characters from the query before building the or() filter', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      users: [{ data: [], error: null }],
      exam_access: [{ data: [], error: null }],
    })
    createClient.mockResolvedValue(supabase)

    await searchEligibleStudents('exam-1', 'ami,na(x)')

    const usersBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'users').value
    expect(usersBuilder.or).toHaveBeenCalledWith('matric_number.ilike.%amina%,full_name.ilike.%amina%')
  })
})

describe('addExamAccessStudent', () => {
  it('returns an error when the exam is not owned by this lecturer', async () => {
    const supabase = createMockSupabaseClient({ exams: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await addExamAccessStudent('exam-1', 'stu-1')

    expect(result).toEqual({ error: 'Exam not found.' })
  })

  it('inserts an exam_access row', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      exam_access: [{ data: null, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await addExamAccessStudent('exam-1', 'stu-1')

    expect(result).toEqual({ ok: true })
    const accessBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'exam_access').value
    expect(accessBuilder.insert).toHaveBeenCalledWith({ exam_id: 'exam-1', user_id: 'stu-1' })
  })

  it('treats a duplicate add (unique violation) as success', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      exam_access: [{ data: null, error: { code: '23505', message: 'duplicate key value' } }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await addExamAccessStudent('exam-1', 'stu-1')

    expect(result).toEqual({ ok: true })
  })
})

describe('removeExamAccessStudent', () => {
  it('returns an error when the exam is not owned by this lecturer', async () => {
    const supabase = createMockSupabaseClient({ exams: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await removeExamAccessStudent('exam-1', 'stu-1')

    expect(result).toEqual({ error: 'Exam not found.' })
  })

  it('deletes the exam_access row for this exam and student', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      exam_access: [{ data: null, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await removeExamAccessStudent('exam-1', 'stu-1')

    expect(result).toEqual({ ok: true })
    const accessBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'exam_access').value
    expect(accessBuilder.eq).toHaveBeenCalledWith('exam_id', 'exam-1')
    expect(accessBuilder.eq).toHaveBeenCalledWith('user_id', 'stu-1')
  })
})
```

Add `searchEligibleStudents, addExamAccessStudent, removeExamAccessStudent` to the existing import line (line 10):

```js
import { generateAccessCode, searchEligibleStudents, addExamAccessStudent, removeExamAccessStudent } from './exams'
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run lib/actions/exams.test.js`
Expected: FAIL — none of the three functions exist yet (`searchEligibleStudents is not a function`, etc.).

- [ ] **Step 4: Implement the three actions**

Open `lib/actions/exams.js`. Add this block after the `generateAccessCode` function (after the closing `}` that follows `return { access_code: code }`):

```js
// ─── Exam access allow-list ──────────────────────────────────────────────────

export async function searchEligibleStudents(examId, query) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }

  const trimmed = query?.trim() ?? ''
  if (trimmed.length < 2) return { students: [] }

  // PostgREST builds its .or() filter by parsing this string — comma
  // separates conditions and parentheses group values, so both are
  // stripped to prevent a search query from injecting extra filter terms.
  const safeQuery = trimmed.replace(/[,()]/g, '')

  const { data: students, error } = await supabase
    .from('users')
    .select('id, full_name, matric_number')
    .eq('university_id', user.university_id)
    .eq('role', 'student')
    .eq('is_active', true)
    .or(`matric_number.ilike.%${safeQuery}%,full_name.ilike.%${safeQuery}%`)
    .order('full_name')
    .limit(20)

  if (error) return { error: 'Search failed.' }

  const { data: existing } = await supabase
    .from('exam_access')
    .select('user_id')
    .eq('exam_id', examId)

  const existingIds = new Set((existing ?? []).map(row => row.user_id))

  return {
    students: (students ?? []).map(student => ({ ...student, added: existingIds.has(student.id) })),
  }
}

export async function addExamAccessStudent(examId, studentId) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }

  const { error } = await supabase
    .from('exam_access')
    .insert({ exam_id: examId, user_id: studentId })

  // 23505 = unique violation — student is already on the allow-list, which
  // is the outcome the caller wanted anyway.
  if (error && error.code !== '23505') {
    return { error: 'Failed to add student.' }
  }

  revalidatePath(`/lecturer/exams/${examId}`)
  return { ok: true }
}

export async function removeExamAccessStudent(examId, studentId) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }

  const { error } = await supabase
    .from('exam_access')
    .delete()
    .eq('exam_id', examId)
    .eq('user_id', studentId)

  if (error) return { error: 'Failed to remove student.' }

  revalidatePath(`/lecturer/exams/${examId}`)
  return { ok: true }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/actions/exams.test.js`
Expected: all tests PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/actions/exams.js lib/actions/exams.test.js tests/helpers/supabaseMock.js
git commit -m "feat: add lecturer server actions for the exam access allow-list"
```

---

### Task 4: Lecturer allow-list UI

**Files:**
- Create: `components/exams/ExamAccessPanel.js`
- Modify: `app/lecturer/exams/[id]/page.js`

**Interfaces:**
- Consumes: `searchEligibleStudents`, `addExamAccessStudent`, `removeExamAccessStudent` from Task 3 (`lib/actions/exams.js`).
- Produces: `<ExamAccessPanel examId={string} initialRestricted={Array<{id, full_name, matric_number}>} />`, a client component rendered on the exam detail page next to `AccessCodePanel`.

This task has no automated tests — the project's test suite is Node-environment only with no component/DOM testing configured (`docs/superpowers/plans/2026-08-04-testing-setup.md`'s Global Constraints scope this out explicitly). Verify this task by running the dev server and checking it in a browser (Step 3).

- [ ] **Step 1: Create the panel component**

Create `components/exams/ExamAccessPanel.js`:

```js
'use client'

import { useState, useTransition } from 'react'
import { Search, UserPlus, X, Users } from 'lucide-react'
import { toast } from 'sonner'
import { searchEligibleStudents, addExamAccessStudent, removeExamAccessStudent } from '@/lib/actions/exams'

export function ExamAccessPanel({ examId, initialRestricted }) {
  const [restricted, setRestricted] = useState(initialRestricted)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [pending, startTransition] = useTransition()

  async function handleSearch(e) {
    e.preventDefault()
    if (query.trim().length < 2) return
    setSearching(true)
    const result = await searchEligibleStudents(examId, query)
    setSearching(false)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    setResults(result.students ?? [])
  }

  function handleAdd(student) {
    startTransition(async () => {
      const result = await addExamAccessStudent(examId, student.id)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      setRestricted(prev => [...prev, student])
      setResults(prev => prev.map(s => (s.id === student.id ? { ...s, added: true } : s)))
    })
  }

  function handleRemove(studentId) {
    startTransition(async () => {
      const result = await removeExamAccessStudent(examId, studentId)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      setRestricted(prev => prev.filter(s => s.id !== studentId))
      setResults(prev => prev.map(s => (s.id === studentId ? { ...s, added: false } : s)))
    })
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Users size={15} className="text-primary" />
        <h3 className="text-sm font-semibold text-text-primary">Exam Access</h3>
      </div>

      {restricted.length === 0 ? (
        <p className="text-xs text-text-muted mb-3">
          Open to all students. Search below to restrict this exam to specific students.
        </p>
      ) : (
        <>
          <p className="text-xs text-text-muted mb-2">
            Restricted to {restricted.length} student{restricted.length !== 1 ? 's' : ''}:
          </p>
          <ul className="space-y-1.5 mb-3">
            {restricted.map(s => (
              <li key={s.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-xs">
                <span>
                  <span className="font-medium text-text-primary">{s.full_name}</span>{' '}
                  <span className="font-mono text-text-muted">{s.matric_number}</span>
                </span>
                <button
                  onClick={() => handleRemove(s.id)}
                  disabled={pending}
                  className="text-text-muted hover:text-danger disabled:opacity-50"
                  title="Remove"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <form onSubmit={handleSearch} className="flex gap-2 mb-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by matric number or name"
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
        <button
          type="submit"
          disabled={searching || query.trim().length < 2}
          className="px-3 py-2 border border-border rounded-lg text-text-muted hover:text-primary disabled:opacity-50"
          title="Search"
        >
          <Search size={14} />
        </button>
      </form>

      {results.length > 0 && (
        <ul className="space-y-1.5">
          {results.map(s => (
            <li key={s.id} className="flex items-center justify-between px-3 py-2 text-xs">
              <span>
                <span className="font-medium text-text-primary">{s.full_name}</span>{' '}
                <span className="font-mono text-text-muted">{s.matric_number}</span>
              </span>
              {s.added ? (
                <span className="text-success">Added</span>
              ) : (
                <button
                  onClick={() => handleAdd(s)}
                  disabled={pending}
                  className="text-primary hover:text-primary-hover disabled:opacity-50"
                  title="Add"
                >
                  <UserPlus size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire the panel into the exam detail page**

Open `app/lecturer/exams/[id]/page.js`.

Add the import (after the existing `AccessCodePanel` import on line 8):

```js
import { ExamAccessPanel } from '@/components/exams/ExamAccessPanel'
```

Add a fourth query to the existing `Promise.all` (currently three queries, lines 21-53). Change:

```js
  const [{ data: exam }, { data: examQuestions }, { data: bankQuestions }] = await Promise.all([
```

to:

```js
  const [{ data: exam }, { data: examQuestions }, { data: bankQuestions }, { data: examAccess }] = await Promise.all([
```

and add this as the fourth entry in the array, after the `bankQuestions` query's closing `,` (i.e. right before the array's closing `])`):

```js

    supabase
      .from('exam_access')
      .select('users:user_id ( id, full_name, matric_number )')
      .eq('exam_id', id),
```

Then, in the JSX, add the panel right after `<AccessCodePanel ... />` (currently lines 135-139):

```jsx
          <AccessCodePanel
            examId={id}
            accessCode={exam.access_code}
            examStatus={exam.status}
          />

          <ExamAccessPanel
            examId={id}
            initialRestricted={(examAccess ?? []).map(row => row.users)}
          />
```

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev`

Then, as a lecturer, open an exam's detail page and confirm:
- The "Exam Access" panel renders below the access code panel, initially showing "Open to all students."
- Searching a matric number or name (2+ characters) returns matching students from your university.
- Clicking the add icon moves a student into the "Restricted to N students" list, and the panel's empty-state message disappears.
- Clicking the remove icon on a listed student removes them; removing the last one returns the panel to "Open to all students."
- Reloading the page preserves the restricted list (confirms the `exam_access` rows persisted, not just client state).

- [ ] **Step 4: Commit**

```bash
git add components/exams/ExamAccessPanel.js app/lecturer/exams/[id]/page.js
git commit -m "feat: add lecturer UI for restricting exam access to specific students"
```
