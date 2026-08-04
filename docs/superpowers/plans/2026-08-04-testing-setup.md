# Testing Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Vitest as OEMS's test runner and write a first round of regression tests for the riskiest, hardest-to-eyeball-verify logic: Zod validation schemas, the central auth guard (`lib/dal.js`), and the two highest-risk server actions (`lib/actions/auth.js`, `lib/actions/admin.js`'s `inviteUser`).

**Architecture:** Vitest (Node environment, no DOM) with a shared chainable Supabase mock (`tests/helpers/supabaseMock.js`) that server-action tests configure per table/call instead of hitting a real database. Tests are colocated next to source as `*.test.js`.

**Tech Stack:** Vitest 4, Node's built-in `FormData` (no extra dependency needed to build form-data test inputs).

## Global Constraints

- Runner: Vitest (not Jest) — native ESM/Vite, no Babel config needed for Next.js 16 + React 19. (spec: Tooling)
- `environment: 'node'` — no component/DOM tests in this round. (spec: Tooling)
- npm scripts: `"test": "vitest run"`, `"test:watch": "vitest"`. (spec: Tooling)
- Test files colocated as `*.test.js` next to the source file they test. (spec: Test layout)
- Shared Supabase mock lives at `tests/helpers/supabaseMock.js`. (spec: Test layout)
- Supabase clients are mocked (`vi.mock`), never a real network call. (spec: Supabase mocking strategy)
- Scope is exactly: `lib/validations/auth.js`, `lib/validations/exams.js`, `lib/validations/questions.js`, `lib/dal.js`, `lib/actions/auth.js`, `lib/actions/admin.js`'s `inviteUser` only. Everything else (`exams.js`, `questions.js`, `attempts.js`, `results.js` actions, e2e, component tests, CI, coverage) is explicitly out of scope for this plan. (spec: Scope / Non-Goals)
- **Adaptation note on TDD steps:** every file under test in this plan already exists and is presumed correct (it's live, seeded, and manually verified in the running app per the user's own testing session). These tasks write *characterization/regression* tests against existing behavior, not tests driving not-yet-written code. So steps are "write the test → run it → confirm it passes," not the usual red-then-green cycle — except Task 1, where the point of the sanity test *is* to prove the harness can fail, so that one does red-then-green for real. If any test in Tasks 3–8 fails on first run, that means either the test's assumption about the source is wrong (fix the test) or a real bug was just found (stop and flag it to the user — do not silently change production behavior as a side effect of a testing task).

---

### Task 1: Install Vitest and configure the runner

**Files:**
- Modify: `package.json`
- Create: `vitest.config.mjs`
- Create: `tests/helpers/server-only-stub.js`
- Create: `tests/sanity.test.js`

**Interfaces:**
- Produces: a working `npm test` command any later task can run. The `@` path alias (`@/lib/...` → repo root) and a `server-only` → no-op alias, both needed because `lib/dal.js` does `import 'server-only'` and every source file under test uses `@/...` imports; Vite/Vitest has no built-in equivalent to Next's webpack aliasing for either.

- [ ] **Step 1: Install Vitest**

Run: `npm install --save-dev vitest@^4.1.10`
Expected: `package.json` gets a `vitest` entry under `devDependencies`, `package-lock.json` updates.

- [ ] **Step 2: Add test scripts to package.json**

In `package.json`, change:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
  },
```

to:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 3: Create the `server-only` no-op stub**

Create `tests/helpers/server-only-stub.js`:

```js
// Vitest stand-in for the `server-only` package.
// Next.js aliases `server-only` at webpack-bundle time to enforce
// server/client boundaries; Vitest has no equivalent, so this no-op
// keeps `import 'server-only'` (used by lib/dal.js) harmless under tests.
export {}
```

- [ ] **Step 4: Create the Vitest config**

Create `vitest.config.mjs`:

```js
import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': __dirname,
      'server-only': path.resolve(__dirname, 'tests/helpers/server-only-stub.js'),
    },
  },
})
```

- [ ] **Step 5: Write a sanity test with a deliberately wrong assertion**

Create `tests/sanity.test.js`:

```js
import { describe, it, expect } from 'vitest'

describe('vitest harness', () => {
  it('runs and reports assertions correctly', () => {
    expect(1 + 1).toBe(3)
  })
})
```

- [ ] **Step 6: Run it and confirm it FAILS**

Run: `npm test`
Expected: FAIL — `expect(1 + 1).toBe(3)` reports `Expected: 3, Received: 2`. This proves the harness actually executes assertions and surfaces failures (not a no-op runner).

- [ ] **Step 7: Fix the assertion and confirm it PASSES**

In `tests/sanity.test.js`, change `toBe(3)` to `toBe(2)`.

Run: `npm test`
Expected: PASS — 1 test file, 1 test passed.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.mjs tests/helpers/server-only-stub.js tests/sanity.test.js
git commit -m "test: add Vitest runner and harness sanity check"
```

---

### Task 2: Shared Supabase mock helper

**Files:**
- Create: `tests/helpers/supabaseMock.js`
- Test: `tests/helpers/supabaseMock.test.js`

**Interfaces:**
- Produces: `createMockSupabaseClient(tableResponses = {})` — every later task imports this from `@/tests/helpers/supabaseMock`.
  - `tableResponses` shape: `{ [tableName]: Array<{ data, error }> }` — an ordered queue of responses per table.
  - Returns an object shaped like a Supabase client:
    - `.from(table)` → a chainable query builder. Every chain method (`select`, `eq`, `in`, `order`, `single`, `update`, `insert`, `upsert`) is a `vi.fn()` returning the same builder (so calls can be inspected via `.mock.calls` if a test needs to). Awaiting the builder (or calling `.then()`) resolves the next queued `{ data, error }` for that table, in order; throws a clear error if the queue for that table is empty.
    - `.auth.getUser`, `.auth.signInWithPassword`, `.auth.signOut`, `.auth.resetPasswordForEmail`, `.auth.updateUser`, `.auth.admin.createUser` — all plain unconfigured `vi.fn()`, so tests call `.mockResolvedValue(...)` on whichever ones they need.

- [ ] **Step 1: Write the mock helper**

Create `tests/helpers/supabaseMock.js`:

```js
import { vi } from 'vitest'

const CHAIN_METHODS = ['select', 'eq', 'in', 'order', 'single', 'update', 'insert', 'upsert']

function createQueryBuilder(table, nextResponse) {
  const builder = {}
  for (const method of CHAIN_METHODS) {
    builder[method] = vi.fn(() => builder)
  }
  builder.then = (onFulfilled, onRejected) =>
    Promise.resolve().then(() => nextResponse(table)).then(onFulfilled, onRejected)
  return builder
}

/**
 * Creates a fake Supabase client for tests. `tableResponses` maps table
 * names to an ordered queue of `{ data, error }` results — each awaited
 * query against that table shifts the next one off the queue.
 */
export function createMockSupabaseClient(tableResponses = {}) {
  const queues = {}
  for (const [table, responses] of Object.entries(tableResponses)) {
    queues[table] = [...responses]
  }

  function nextResponse(table) {
    const queue = queues[table]
    if (!queue || queue.length === 0) {
      throw new Error(`createMockSupabaseClient: no response queued for table "${table}"`)
    }
    return queue.shift()
  }

  return {
    from: vi.fn((table) => createQueryBuilder(table, nextResponse)),
    auth: {
      getUser: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      admin: {
        createUser: vi.fn(),
      },
    },
  }
}
```

- [ ] **Step 2: Write tests for the helper itself**

Create `tests/helpers/supabaseMock.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { createMockSupabaseClient } from './supabaseMock'

describe('createMockSupabaseClient', () => {
  it('resolves the queued response for a table', async () => {
    const client = createMockSupabaseClient({
      users: [{ data: { id: '1' }, error: null }],
    })

    const result = await client.from('users').select('*').eq('id', '1').single()

    expect(result).toEqual({ data: { id: '1' }, error: null })
  })

  it('shifts through multiple queued responses in order', async () => {
    const client = createMockSupabaseClient({
      users: [
        { data: { id: '1' }, error: null },
        { data: { id: '2' }, error: null },
      ],
    })

    const first = await client.from('users').select('*').single()
    const second = await client.from('users').select('*').single()

    expect(first.data.id).toBe('1')
    expect(second.data.id).toBe('2')
  })

  it('throws a clear error when no response is queued for a table', async () => {
    const client = createMockSupabaseClient({})

    await expect(client.from('users').select('*')).rejects.toThrow(
      'no response queued for table "users"'
    )
  })

  it('exposes vi.fn() auth methods that tests can configure per-case', async () => {
    const client = createMockSupabaseClient()
    client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })

    const result = await client.auth.getUser()

    expect(result.data.user.id).toBe('u1')
  })
})
```

- [ ] **Step 3: Run and confirm all pass**

Run: `npx vitest run tests/helpers/supabaseMock.test.js`
Expected: PASS — 4 tests passed.

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/supabaseMock.js tests/helpers/supabaseMock.test.js
git commit -m "test: add shared Supabase mock helper for action/dal tests"
```

---

### Task 3: `lib/validations/auth.js` tests

**Files:**
- Test: `lib/validations/auth.test.js`

**Interfaces:**
- Consumes: `loginSchema`, `forgotPasswordSchema`, `resetPasswordSchema` from `./auth` (already exported, no changes).

- [ ] **Step 1: Write the test file**

Create `lib/validations/auth.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { loginSchema, forgotPasswordSchema, resetPasswordSchema } from './auth'

describe('loginSchema', () => {
  it('accepts a valid email and password', () => {
    const result = loginSchema.safeParse({ email: 'user@example.com', password: 'secret1' })
    expect(result.success).toBe(true)
  })

  it('rejects a missing email', () => {
    const result = loginSchema.safeParse({ email: '', password: 'secret1' })
    expect(result.success).toBe(false)
    expect(result.error.flatten().fieldErrors.email).toContain('Email is required')
  })

  it('rejects an invalid email format', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'secret1' })
    expect(result.success).toBe(false)
    expect(result.error.flatten().fieldErrors.email).toContain('Enter a valid email address')
  })

  it('rejects a password shorter than 6 characters', () => {
    const result = loginSchema.safeParse({ email: 'user@example.com', password: '123' })
    expect(result.success).toBe(false)
    expect(result.error.flatten().fieldErrors.password).toContain('Password must be at least 6 characters')
  })
})

describe('forgotPasswordSchema', () => {
  it('accepts a valid email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'user@example.com' }).success).toBe(true)
  })

  it('rejects an invalid email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'nope' }).success).toBe(false)
  })
})

describe('resetPasswordSchema', () => {
  it('accepts matching passwords of at least 8 characters', () => {
    const result = resetPasswordSchema.safeParse({ password: 'longenough', confirmPassword: 'longenough' })
    expect(result.success).toBe(true)
  })

  it('rejects mismatched passwords', () => {
    const result = resetPasswordSchema.safeParse({ password: 'longenough', confirmPassword: 'different' })
    expect(result.success).toBe(false)
    expect(result.error.flatten().fieldErrors.confirmPassword).toContain('Passwords do not match')
  })

  it('rejects a password shorter than 8 characters', () => {
    const result = resetPasswordSchema.safeParse({ password: 'short1', confirmPassword: 'short1' })
    expect(result.success).toBe(false)
    expect(result.error.flatten().fieldErrors.password).toContain('Password must be at least 8 characters')
  })
})
```

- [ ] **Step 2: Run and confirm all pass**

Run: `npx vitest run lib/validations/auth.test.js`
Expected: PASS — 9 tests passed. If any fail, re-check the assertion against `lib/validations/auth.js` — do not modify the schema as part of this task.

- [ ] **Step 3: Commit**

```bash
git add lib/validations/auth.test.js
git commit -m "test: add lib/validations/auth.js coverage"
```

---

### Task 4: `lib/validations/exams.js` tests

**Files:**
- Test: `lib/validations/exams.test.js`

**Interfaces:**
- Consumes: `examSettingsSchema` from `./exams` (already exported, no changes).

- [ ] **Step 1: Write the test file**

Create `lib/validations/exams.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { examSettingsSchema } from './exams'

const validExam = {
  title: 'CSC 301 First C.A. Test',
  course_id: '11111111-1111-4111-a111-111111111111',
  exam_type: 'ca',
  academic_session: '2024/2025',
  semester: 'first',
  duration_minutes: 45,
  pass_mark: 50,
}

describe('examSettingsSchema', () => {
  it('accepts a minimal valid exam and applies defaults', () => {
    const result = examSettingsSchema.safeParse(validExam)
    expect(result.success).toBe(true)
    expect(result.data.randomise_questions).toBe(false)
    expect(result.data.randomise_options).toBe(false)
    expect(result.data.exam_mode).toBe('remote')
    expect(result.data.proctoring_enabled).toBe(false)
    expect(result.data.show_calculator).toBe(false)
    expect(result.data.tips).toEqual([])
  })

  it('rejects a title shorter than 3 characters', () => {
    expect(examSettingsSchema.safeParse({ ...validExam, title: 'ab' }).success).toBe(false)
  })

  it('rejects a non-UUID course_id', () => {
    expect(examSettingsSchema.safeParse({ ...validExam, course_id: 'not-a-uuid' }).success).toBe(false)
  })

  it('rejects an academic_session not in YYYY/YYYY format', () => {
    expect(examSettingsSchema.safeParse({ ...validExam, academic_session: '2024-2025' }).success).toBe(false)
  })

  it('rejects a duration outside 5-300 minutes', () => {
    expect(examSettingsSchema.safeParse({ ...validExam, duration_minutes: 2 }).success).toBe(false)
    expect(examSettingsSchema.safeParse({ ...validExam, duration_minutes: 301 }).success).toBe(false)
  })

  it('rejects a pass_mark outside 0-100', () => {
    expect(examSettingsSchema.safeParse({ ...validExam, pass_mark: 150 }).success).toBe(false)
  })

  it('accepts end_at after start_at', () => {
    const result = examSettingsSchema.safeParse({
      ...validExam,
      start_at: '2025-01-01T09:00:00.000Z',
      end_at: '2025-01-01T10:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects end_at at or before start_at', () => {
    const result = examSettingsSchema.safeParse({
      ...validExam,
      start_at: '2025-01-01T10:00:00.000Z',
      end_at: '2025-01-01T09:00:00.000Z',
    })
    expect(result.success).toBe(false)
    expect(result.error.flatten().fieldErrors.end_at).toContain('End date/time must be after start date/time')
  })
})
```

- [ ] **Step 2: Run and confirm all pass**

Run: `npx vitest run lib/validations/exams.test.js`
Expected: PASS — 8 tests passed.

- [ ] **Step 3: Commit**

```bash
git add lib/validations/exams.test.js
git commit -m "test: add lib/validations/exams.js coverage"
```

---

### Task 5: `lib/validations/questions.js` tests

**Files:**
- Test: `lib/validations/questions.test.js`

**Interfaces:**
- Consumes: `questionSchema` from `./questions` (already exported, no changes).

- [ ] **Step 1: Write the test file**

Create `lib/validations/questions.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { questionSchema } from './questions'

const courseId = '11111111-1111-4111-a111-111111111111'

describe('questionSchema', () => {
  it('accepts a valid MCQ question', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'mcq',
      difficulty: 'easy',
      body: '<p>What is 2 + 2?</p>',
      options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }],
      correct_answer: 'b',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an MCQ with fewer than 2 options', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'mcq',
      difficulty: 'easy',
      body: '<p>What is 2 + 2?</p>',
      options: [{ id: 'a', text: '4' }],
      correct_answer: 'a',
    })
    expect(result.success).toBe(false)
    expect(result.error.issues.some(i => i.path.join('.') === 'options')).toBe(true)
  })

  it('rejects an MCQ with no correct_answer selected', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'mcq',
      difficulty: 'easy',
      body: '<p>What is 2 + 2?</p>',
      options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }],
    })
    expect(result.success).toBe(false)
    expect(result.error.issues.some(i => i.path.join('.') === 'correct_answer')).toBe(true)
  })

  it('rejects a multi_select answer that is not a non-empty array', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'multi_select',
      difficulty: 'medium',
      body: '<p>Select all prime numbers.</p>',
      options: [{ id: 'a', text: '2' }, { id: 'b', text: '4' }],
      correct_answer: 'a',
    })
    expect(result.success).toBe(false)
    expect(result.error.issues.some(i => i.path.join('.') === 'correct_answer')).toBe(true)
  })

  it('accepts a valid multi_select question', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'multi_select',
      difficulty: 'medium',
      body: '<p>Select all prime numbers.</p>',
      options: [{ id: 'a', text: '2' }, { id: 'b', text: '4' }],
      correct_answer: ['a'],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a true_false question with no correct_answer', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'true_false',
      difficulty: 'easy',
      body: '<p>The sky is blue.</p>',
      options: [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a fill_blank question with an empty correct_answer', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'fill_blank',
      difficulty: 'medium',
      body: '<p>The capital of Nigeria is ___.</p>',
      correct_answer: '   ',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a fill_blank question with a non-empty correct_answer', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'fill_blank',
      difficulty: 'medium',
      body: '<p>The capital of Nigeria is ___.</p>',
      correct_answer: 'Abuja',
    })
    expect(result.success).toBe(true)
  })

  it('accepts an essay question with no options or correct_answer required', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'essay',
      difficulty: 'hard',
      body: '<p>Discuss the causes of the Nigerian Civil War.</p>',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a body that strips down to fewer than 5 characters', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'essay',
      difficulty: 'hard',
      body: '<p>Hi</p>',
    })
    expect(result.success).toBe(false)
    expect(result.error.issues.some(i => i.path.join('.') === 'body')).toBe(true)
  })
})
```

- [ ] **Step 2: Run and confirm all pass**

Run: `npx vitest run lib/validations/questions.test.js`
Expected: PASS — 10 tests passed.

- [ ] **Step 3: Commit**

```bash
git add lib/validations/questions.test.js
git commit -m "test: add lib/validations/questions.js coverage"
```

---

### Task 6: `lib/dal.js` tests

**Files:**
- Test: `lib/dal.test.js`

**Interfaces:**
- Consumes: `createMockSupabaseClient` from `@/tests/helpers/supabaseMock` (Task 2).
- Consumes: `getAuthUser`, `requireRole`, `roleHome` from `./dal` (already exported, no changes).
- Mocks: `@/lib/supabase/server` (`createClient`), `next/navigation` (`redirect` — thrown as `Error('REDIRECT:<path>')` so tests can assert the target with `.rejects.toThrow(...)`, mirroring how Next's real `redirect()` aborts execution by throwing).

- [ ] **Step 1: Write the test file**

Create `lib/dal.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path) => { throw new Error(`REDIRECT:${path}`) }),
}))

import { createClient } from '@/lib/supabase/server'
import { getAuthUser, requireRole, roleHome } from './dal'

function mockClientWithProfile(profile, { authError = null, profileError = null } = {}) {
  const client = createMockSupabaseClient({
    users: [{ data: profileError ? null : profile, error: profileError }],
  })
  client.auth.getUser.mockResolvedValue({
    data: { user: authError ? null : { id: profile?.id ?? 'u1' } },
    error: authError,
  })
  return client
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getAuthUser', () => {
  it('redirects to /login when there is no session', async () => {
    createClient.mockResolvedValue(mockClientWithProfile(null, { authError: new Error('no session') }))

    await expect(getAuthUser()).rejects.toThrow('REDIRECT:/login')
  })

  it('redirects to /login when the profile lookup fails', async () => {
    createClient.mockResolvedValue(mockClientWithProfile(null, { profileError: new Error('not found') }))

    await expect(getAuthUser()).rejects.toThrow('REDIRECT:/login')
  })

  it('redirects to /login?error=account_suspended when the account is inactive', async () => {
    const profile = { id: 'u1', role: 'student', is_active: false }
    createClient.mockResolvedValue(mockClientWithProfile(profile))

    await expect(getAuthUser()).rejects.toThrow('REDIRECT:/login?error=account_suspended')
  })

  it('returns the profile when the session and account are valid', async () => {
    const profile = { id: 'u1', role: 'student', is_active: true }
    createClient.mockResolvedValue(mockClientWithProfile(profile))

    await expect(getAuthUser()).resolves.toEqual(profile)
  })
})

describe('requireRole', () => {
  it('returns the user when their role is allowed', async () => {
    const profile = { id: 'u1', role: 'lecturer', is_active: true }
    createClient.mockResolvedValue(mockClientWithProfile(profile))

    await expect(requireRole('lecturer', 'school_admin')).resolves.toEqual(profile)
  })

  it("redirects to the user's role home when their role is not allowed", async () => {
    const profile = { id: 'u1', role: 'student', is_active: true }
    createClient.mockResolvedValue(mockClientWithProfile(profile))

    await expect(requireRole('lecturer')).rejects.toThrow('REDIRECT:/student/dashboard')
  })
})

describe('roleHome', () => {
  it('maps each known role to its dashboard route', () => {
    expect(roleHome('super_admin')).toBe('/super-admin/dashboard')
    expect(roleHome('school_admin')).toBe('/admin/dashboard')
    expect(roleHome('lecturer')).toBe('/lecturer/dashboard')
    expect(roleHome('student')).toBe('/student/dashboard')
  })

  it('falls back to /login for an unknown role', () => {
    expect(roleHome('nonexistent')).toBe('/login')
  })
})
```

- [ ] **Step 2: Run and confirm all pass**

Run: `npx vitest run lib/dal.test.js`
Expected: PASS — 8 tests passed.

- [ ] **Step 3: Commit**

```bash
git add lib/dal.test.js
git commit -m "test: add lib/dal.js coverage"
```

---

### Task 7: `lib/actions/auth.js` tests

**Files:**
- Test: `lib/actions/auth.test.js`

**Interfaces:**
- Consumes: `createMockSupabaseClient` from `@/tests/helpers/supabaseMock` (Task 2).
- Consumes: `signIn`, `signOut`, `forgotPassword`, `updatePassword` from `./auth` (already exported, no changes).
- Mocks: `@/lib/supabase/server` (`createClient`), `next/navigation` (`redirect`, same throw-based mock as Task 6).

- [ ] **Step 1: Write the test file**

Create `lib/actions/auth.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path) => { throw new Error(`REDIRECT:${path}`) }),
}))

import { createClient } from '@/lib/supabase/server'
import { signIn, signOut, forgotPassword, updatePassword } from './auth'

function formData(fields) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'
})

describe('signIn', () => {
  it('returns validation errors for an invalid email without calling Supabase', async () => {
    const client = createMockSupabaseClient()
    createClient.mockResolvedValue(client)

    const result = await signIn(undefined, formData({ email: 'nope', password: 'secret1' }))

    expect(result.errors.email).toContain('Enter a valid email address')
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('returns a friendly error for invalid credentials', async () => {
    const client = createMockSupabaseClient()
    client.auth.signInWithPassword.mockResolvedValue({ data: null, error: { message: 'Invalid login credentials' } })
    createClient.mockResolvedValue(client)

    const result = await signIn(undefined, formData({ email: 'user@example.com', password: 'secret1' }))

    expect(result.errors._form).toBe('Incorrect email or password. Please try again.')
  })

  it('returns a generic error for other Supabase auth failures', async () => {
    const client = createMockSupabaseClient()
    client.auth.signInWithPassword.mockResolvedValue({ data: null, error: { message: 'Network error' } })
    createClient.mockResolvedValue(client)

    const result = await signIn(undefined, formData({ email: 'user@example.com', password: 'secret1' }))

    expect(result.errors._form).toBe('Something went wrong. Please try again later.')
  })

  it('redirects to the role home on success', async () => {
    const client = createMockSupabaseClient({
      users: [{ data: { role: 'lecturer' }, error: null }],
    })
    client.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    createClient.mockResolvedValue(client)

    await expect(signIn(undefined, formData({ email: 'user@example.com', password: 'secret1' })))
      .rejects.toThrow('REDIRECT:/lecturer/dashboard')
  })
})

describe('signOut', () => {
  it('signs out and redirects to /login', async () => {
    const client = createMockSupabaseClient()
    client.auth.signOut.mockResolvedValue({ error: null })
    createClient.mockResolvedValue(client)

    await expect(signOut()).rejects.toThrow('REDIRECT:/login')
    expect(client.auth.signOut).toHaveBeenCalled()
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

- [ ] **Step 2: Run and confirm all pass**

Run: `npx vitest run lib/actions/auth.test.js`
Expected: PASS — 10 tests passed.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/auth.test.js
git commit -m "test: add lib/actions/auth.js coverage"
```

---

### Task 8: `lib/actions/admin.js` — `inviteUser` tests

**Files:**
- Test: `lib/actions/admin.test.js`

**Interfaces:**
- Consumes: `createMockSupabaseClient` from `@/tests/helpers/supabaseMock` (Task 2).
- Consumes: `inviteUser` from `./admin` (already exported, no changes). Only `inviteUser` is in scope per spec — `toggleUserActive`, `createFaculty`, `createDepartment`, `createCourse`, `createUniversity`, `superAdminToggleUserActive` are not tested in this task.
- Mocks: `@/lib/dal` (`requireRole` — mocked directly rather than driven through a fake session, since `requireRole`'s own behavior is already covered by Task 6), `@/lib/supabase/admin` (`createAdminClient`), `@/lib/supabase/server` (`createClient`), `next/cache` (`revalidatePath`).
- **Important:** this test locks in today's behavior, including the hardcoded `'ChangeMe123!'` temp password. The forced-password-reset workstream (tracked in `tdl.md`) will change `inviteUser`'s password behavior — when that happens, the "creates the user with a temporary password" test below must be updated deliberately, not left to silently rot.

- [ ] **Step 1: Write the test file**

Create `lib/actions/admin.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/dal', () => ({
  requireRole: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { requireRole } from '@/lib/dal'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { inviteUser } from './admin'

function formData(fields) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

const schoolAdmin = { id: 'admin-1', role: 'school_admin', university_id: 'uni-1' }

beforeEach(() => {
  vi.clearAllMocks()
  requireRole.mockResolvedValue(schoolAdmin)
})

describe('inviteUser', () => {
  it('returns validation errors for an invalid email without creating a user', async () => {
    const adminClient = createMockSupabaseClient()
    createAdminClient.mockReturnValue(adminClient)

    const result = await inviteUser(undefined, formData({ email: 'nope', full_name: 'Jane Doe', role: 'lecturer' }))

    expect(result.errors.email).toBeDefined()
    expect(adminClient.auth.admin.createUser).not.toHaveBeenCalled()
  })

  it('requires a matric number when inviting a student', async () => {
    const adminClient = createMockSupabaseClient()
    createAdminClient.mockReturnValue(adminClient)

    const result = await inviteUser(undefined, formData({
      email: 'student@example.com', full_name: 'A Student', role: 'student',
    }))

    expect(result.errors.matric_number).toEqual(['Matric number is required for students.'])
    expect(adminClient.auth.admin.createUser).not.toHaveBeenCalled()
  })

  it('creates the user with a temporary password and the right metadata', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.createUser.mockResolvedValue({
      data: { user: { id: 'new-user-1' } },
      error: null,
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await inviteUser(undefined, formData({
      email: 'lecturer@example.com', full_name: 'Dr. New', role: 'lecturer',
    }))

    expect(adminClient.auth.admin.createUser).toHaveBeenCalledWith({
      email: 'lecturer@example.com',
      password: 'ChangeMe123!',
      email_confirm: true,
      user_metadata: {
        full_name: 'Dr. New',
        role: 'lecturer',
        university_id: 'uni-1',
        matric_number: null,
        level: null,
      },
    })
    expect(result).toEqual({ ok: true, email: 'lecturer@example.com' })
  })

  it('maps a duplicate-email Supabase error to a field error', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.createUser.mockResolvedValue({
      data: null,
      error: { message: 'Email already registered' },
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await inviteUser(undefined, formData({
      email: 'dup@example.com', full_name: 'Dup User', role: 'lecturer',
    }))

    expect(result.errors.email).toEqual(['This email is already registered.'])
  })

  it('updates department and faculty after creating the user when provided', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.createUser.mockResolvedValue({
      data: { user: { id: 'new-user-2' } },
      error: null,
    })
    createAdminClient.mockReturnValue(adminClient)

    const serverClient = createMockSupabaseClient({ users: [{ data: null, error: null }] })
    createClient.mockResolvedValue(serverClient)

    const deptId = '11111111-1111-4111-a111-111111111111'
    const facId = '22222222-2222-4222-a222-222222222222'

    const result = await inviteUser(undefined, formData({
      email: 'lecturer2@example.com', full_name: 'Dr. Two', role: 'lecturer',
      department_id: deptId, faculty_id: facId,
    }))

    expect(createClient).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, email: 'lecturer2@example.com' })
  })
})
```

- [ ] **Step 2: Run and confirm all pass**

Run: `npx vitest run lib/actions/admin.test.js`
Expected: PASS — 5 tests passed.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/admin.test.js
git commit -m "test: add lib/actions/admin.js inviteUser coverage"
```

---

### Task 9: Full suite check and tdl.md update

**Files:**
- Modify: `tdl.md`

**Interfaces:**
- None — this is a verification + bookkeeping task, no new code.

- [ ] **Step 1: Run the entire suite**

Run: `npm test`
Expected: PASS — all 8 test files (sanity + supabaseMock + 3 validations + dal + 2 actions), 55 tests total, green with no failures.

- [ ] **Step 2: Update tdl.md**

In `tdl.md`, change the "Automated tests" line from:

```markdown
- [ ] Automated tests (Vitest/Playwright) — none exist yet
```

to:

```markdown
- [x] Automated tests (Vitest) — Vitest set up; regression tests cover lib/validations/*, lib/dal.js, lib/actions/auth.js, lib/actions/admin.js's inviteUser. Still pending: lib/actions/exams.js, questions.js, attempts.js, results.js, and any Playwright e2e coverage.
```

- [ ] **Step 3: Commit**

```bash
git add tdl.md
git commit -m "docs: mark testing-setup workstream progress in tdl.md"
```
