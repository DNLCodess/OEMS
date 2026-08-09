# Exam Timing and Entry Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed wall-clock exam scheduling with a duration-based entry window relative to a manual "Go Live" click, and close the gap where nothing server-side ever enforced a student's own answering-time limit.

**Architecture:** Two new `exams` columns (`go_live_at`, stamped server-side only; `entry_window_minutes`, lecturer-configured) gate *new* attempt starts independently of the exam's `status`. Existing in-progress attempts are governed entirely by their own `started_at + duration_minutes`, now checked server-side in `saveAnswer` (reject) and lazily in `startExam`'s resume path (auto-submit if abandoned past deadline) — `submitExam` itself stays unconditionally callable. `/lab/{code}` becomes dual-mode so a lab machine can be pre-loaded once, before go-live, with students only ever typing their matric number.

**Tech Stack:** Next.js 16 Server Actions, Supabase (Postgres/RLS), Vitest.

## Global Constraints

- No fixed wall-clock scheduling — `start_at`/`end_at` are removed from the exam settings form and validation; the columns stay in the schema, unused, per the same "hide, don't delete" pattern used elsewhere this session. (spec: §6)
- `go_live_at` is never lecturer-editable — stamped only by `updateExamStatus` on the `live` transition. (spec: §1)
- The entry window (`go_live_at + entry_window_minutes`) gates only *new* attempt starts (`verifyExamAccess`). It does not gate `startExam`'s resume path, and it does not auto-close the exam's `status` — "Close Exam" stays fully manual. (spec: §2)
- `submitExam` must never be time-blocked — it is the only way out of the time-over state. (spec: §3)
- `saveAnswer`'s time cutoff includes a fixed 60-second grace period, not lecturer-configurable. (spec: §3)
- The existing generic matric+code entry page stays as a fallback — this plan adds a second entry surface, it does not replace the first. (spec: §4)
- No new dependencies, no cron/background-job infrastructure — the lazy-check-on-read pattern in Task 6 is the deliberately smallest mechanism, not a general scheduler. (spec: Non-goals)

---

### Task 1: Migration — go_live_at and entry_window_minutes

**Files:**
- Create: `supabase/migrations/20260809180000_exam_entry_window.sql`

**Interfaces:**
- Produces: `exams.go_live_at` (nullable `TIMESTAMPTZ`) and `exams.entry_window_minutes` (`INT NOT NULL DEFAULT 10`, `CHECK (entry_window_minutes > 0)`). Every later task depends on these columns existing.

- [ ] **Step 1: Write the migration file**

```sql
-- Exam timing redesign: duration-based entry window instead of fixed wall-clock scheduling
-- Applied: (pending)

-- go_live_at: stamped automatically the moment a lecturer transitions an
-- exam to 'live' (updateExamStatus) — never set directly by a lecturer.
-- Combined with entry_window_minutes, this replaces fixed start_at/end_at
-- scheduling (columns still present in the schema, unused) with a window
-- relative to the actual moment the exam opened, which survives a late
-- start correctly — a fixed pre-set clock time does not.
ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS go_live_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entry_window_minutes INT NOT NULL DEFAULT 10 CHECK (entry_window_minutes > 0);
```

- [ ] **Step 2: Apply the migration directly against the live Supabase project**

Use the `mcp__supabase__apply_migration` tool with `name: "exam_entry_window"` and the SQL body above (the tool handles the migration-history bookkeeping; don't hand-write a version number). This is a live database change — read the tool's result carefully and confirm it reports success before proceeding.

- [ ] **Step 3: Verify against the live project**

Use `mcp__supabase__execute_sql` (read-only) to confirm: `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'exams' AND column_name IN ('go_live_at', 'entry_window_minutes');` — expect two rows, `go_live_at` nullable with no default, `entry_window_minutes` not-null with default `10`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260809180000_exam_entry_window.sql
git commit -m "feat: add go_live_at and entry_window_minutes columns to exams"
```

---

### Task 2: Stamp go_live_at on the live transition

**Files:**
- Modify: `lib/actions/exams.js:369-404` (`updateExamStatus`)
- Test: `lib/actions/exams.test.js`

**Interfaces:**
- Consumes: Task 1's `go_live_at` column.
- Produces: `updateExamStatus(examId, 'live')` sets `go_live_at` to the current time. Task 4 relies on this being set exactly once, at the real moment of going live.

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `lib/actions/exams.test.js`, following the file's existing conventions (see `describe('generateAccessCode', ...)` at the top for the mock/import pattern already in this file):

```javascript
import { updateExamStatus } from './exams'

describe('updateExamStatus', () => {
  it('stamps go_live_at when transitioning to live', async () => {
    const supabase = createMockSupabaseClient({
      exams: [
        { data: { id: 'exam-1', status: 'scheduled', created_by: 'lect-1', university_id: 'uni-1' }, error: null }, // getOwnedExam
        { data: { id: 1 }, count: 3, error: null }, // question count guard
        { data: null, error: null }, // the update itself
      ],
    })
    createClient.mockResolvedValue(supabase)

    await updateExamStatus('exam-1', 'live')

    const examsBuilder = supabase.from.mock.results[2].value
    const updatePayload = examsBuilder.update.mock.calls[0][0]
    expect(updatePayload.status).toBe('live')
    expect(updatePayload.go_live_at).toEqual(expect.any(String))
    expect(new Date(updatePayload.go_live_at).toString()).not.toBe('Invalid Date')
  })

  it('does not set go_live_at when transitioning to a non-live status', async () => {
    const supabase = createMockSupabaseClient({
      exams: [
        { data: { id: 'exam-1', status: 'live', created_by: 'lect-1', university_id: 'uni-1' }, error: null },
        { data: null, error: null },
      ],
    })
    createClient.mockResolvedValue(supabase)

    await updateExamStatus('exam-1', 'closed')

    const examsBuilder = supabase.from.mock.results[1].value
    const updatePayload = examsBuilder.update.mock.calls[0][0]
    expect(updatePayload.status).toBe('closed')
    expect(updatePayload.go_live_at).toBeUndefined()
  })
})
```

Note: the `count` field in the second queued `exams` response above matches how this file's existing `generateAccessCode`/question-count-guard tests express a `.select('id', { count: 'exact', head: true })` result — read a neighboring test in the file if the mock shape doesn't line up exactly, since `createMockSupabaseClient`'s exact `count` handling should match established usage elsewhere in this file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/actions/exams.test.js -t "updateExamStatus"`
Expected: FAIL — `updatePayload.go_live_at` is `undefined` in the first test.

- [ ] **Step 3: Update `updateExamStatus`**

In `lib/actions/exams.js`, replace:

```javascript
  const { error } = await supabase
    .from('exams')
    .update({ status: newStatus })
    .eq('id', examId)
```

with:

```javascript
  const updatePayload = { status: newStatus }
  // go_live_at is stamped exactly once, at the real moment the lecturer
  // opens the exam — never lecturer-editable, and never touched on any
  // other transition (including live -> closed, or a later re-open, since
  // 'closed' has no outgoing transitions per VALID_TRANSITIONS above).
  if (newStatus === 'live') {
    updatePayload.go_live_at = new Date().toISOString()
  }

  const { error } = await supabase
    .from('exams')
    .update(updatePayload)
    .eq('id', examId)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/actions/exams.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/exams.js lib/actions/exams.test.js
git commit -m "feat: stamp go_live_at when an exam transitions to live"
```

---

### Task 3: entry_window_minutes field; remove start_at/end_at

**Files:**
- Modify: `lib/validations/exams.js`
- Modify: `components/exams/ExamSettingsForm.js`

**Interfaces:**
- Produces: `examSettingsSchema` no longer has `start_at`/`end_at`; gains `entry_window_minutes` (int, 1–180, required). `createExam`/`updateExamSettings` in `lib/actions/exams.js` need no changes — both already spread `parsed.data` straight into the insert/update, so removing/adding schema fields flows through automatically.

- [ ] **Step 1: Update `lib/validations/exams.js`**

Replace the whole file with:

```javascript
import { z } from 'zod'

export const examSettingsSchema = z.object({
  title: z
    .string()
    .min(3, 'Title must be at least 3 characters')
    .max(200, 'Title is too long'),
  course_id: z.string().uuid('Select a course'),
  exam_type: z.enum(['ca', 'mid_semester', 'end_of_semester'], {
    required_error: 'Select an exam type',
  }),
  academic_session: z
    .string()
    .regex(/^\d{4}\/\d{4}$/, 'Format: YYYY/YYYY  e.g. 2024/2025'),
  semester: z.enum(['first', 'second'], { required_error: 'Select a semester' }),
  duration_minutes: z.coerce
    .number({ invalid_type_error: 'Enter a duration' })
    .int()
    .min(5,  'Minimum duration is 5 minutes')
    .max(300, 'Maximum duration is 300 minutes'),
  entry_window_minutes: z.coerce
    .number({ invalid_type_error: 'Enter an entry window' })
    .int()
    .min(1,   'Minimum is 1 minute')
    .max(180, 'Maximum is 180 minutes'),
  pass_mark: z.coerce
    .number({ invalid_type_error: 'Enter a pass mark' })
    .int()
    .min(0,   'Minimum is 0')
    .max(100, 'Maximum is 100'),
  instructions:        z.string().optional().nullable(),
  randomise_questions: z.boolean().default(false),
  randomise_options:   z.boolean().default(false),
  // Delivery & tools
  exam_mode:           z.enum(['remote', 'lab']).default('lab'),
  proctoring_enabled:  z.boolean().default(false),
  show_calculator:     z.boolean().default(false),
  tips:                z.array(z.string().max(300)).default([]),
})
```

(The `start_at`/`end_at` fields and the `.refine(...)` block that validated their ordering are both gone — there's nothing left to cross-validate.)

- [ ] **Step 2: Update `components/exams/ExamSettingsForm.js`**

Remove `start_at`/`end_at` from both `defaultValues` branches. Replace:

```javascript
    defaultValues: exam
      ? {
          ...exam,
          duration_minutes:    exam.duration_minutes,
          pass_mark:           exam.pass_mark,
          start_at:            exam.start_at ? exam.start_at.slice(0, 16) : '',
          end_at:              exam.end_at   ? exam.end_at.slice(0, 16)   : '',
          randomise_questions: exam.randomise_questions ?? false,
```

with:

```javascript
    defaultValues: exam
      ? {
          ...exam,
          duration_minutes:     exam.duration_minutes,
          entry_window_minutes: exam.entry_window_minutes ?? 10,
          pass_mark:            exam.pass_mark,
          randomise_questions:  exam.randomise_questions ?? false,
```

and replace:

```javascript
      : {
          academic_session:    CURRENT_SESSION,
          duration_minutes:    60,
          pass_mark:           40,
```

with:

```javascript
      : {
          academic_session:     CURRENT_SESSION,
          duration_minutes:     60,
          entry_window_minutes: 10,
          pass_mark:            40,
```

Remove `start_at`/`end_at` from the submit payload. Replace:

```javascript
    const payload = {
      ...data,
      start_at: data.start_at || null,
      end_at:   data.end_at   || null,
      // Unwrap tips from { value } objects
```

with:

```javascript
    const payload = {
      ...data,
      // Unwrap tips from { value } objects
```

Replace the "Timing & Scoring" section's field grid — currently a duration/pass-mark row followed by a separate start/end-date row:

```javascript
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Duration (minutes)" id="duration_minutes" type="number" required min={5} max={300}
            error={errors.duration_minutes?.message}
            {...register('duration_minutes')}
          />
          <Input
            label="Pass Mark (%)" id="pass_mark" type="number" required min={0} max={100}
            hint="Minimum percentage to pass."
            error={errors.pass_mark?.message}
            {...register('pass_mark')}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Start Date & Time" id="start_at" type="datetime-local"
            hint="Leave blank for manual activation."
            error={errors.start_at?.message}
            {...register('start_at')}
          />
          <Input
            label="End Date & Time" id="end_at" type="datetime-local"
            error={errors.end_at?.message}
            {...register('end_at')}
          />
        </div>
```

with:

```javascript
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Duration (minutes)" id="duration_minutes" type="number" required min={5} max={300}
            hint="How long each student gets to answer, once they start."
            error={errors.duration_minutes?.message}
            {...register('duration_minutes')}
          />
          <Input
            label="Pass Mark (%)" id="pass_mark" type="number" required min={0} max={100}
            hint="Minimum percentage to pass."
            error={errors.pass_mark?.message}
            {...register('pass_mark')}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Entry Window (minutes)" id="entry_window_minutes" type="number" required min={1} max={180}
            hint="How long after you click Go Live new students may still start."
            error={errors.entry_window_minutes?.message}
            {...register('entry_window_minutes')}
          />
        </div>
```

(This exam is scheduled by clicking "Go Live" when the sitting actually begins, not by a pre-set date/time — the entry window is relative to that moment.)

- [ ] **Step 3: Run `npx next build`**

Run: `npx next build`
Expected: succeeds with no errors referencing these two files.

- [ ] **Step 4: Commit**

```bash
git add lib/validations/exams.js components/exams/ExamSettingsForm.js
git commit -m "feat: replace fixed start/end scheduling with entry_window_minutes"
```

---

### Task 4: Entry-window check in verifyExamAccess

**Files:**
- Modify: `lib/actions/studentAuth.js:53-96` (`verifyExamAccess`)
- Test: `lib/actions/studentAuth.test.js`

**Interfaces:**
- Consumes: Task 1's `go_live_at`/`entry_window_minutes` columns.
- Produces: `verifyExamAccess` rejects (same `GENERIC_ERROR`, no new error shape) once `now > go_live_at + entry_window_minutes`, or if `go_live_at` is still null despite `status === 'live'` (defensive — Task 2 should make this unreachable, but fail closed rather than open if it ever happens).

- [ ] **Step 1: Write the failing tests**

Add to `lib/actions/studentAuth.test.js`'s `describe('verifyExamAccess', ...)` block, following the existing mock conventions in that file (see the "mints a session and redirects…" test for the full happy-path shape):

```javascript
  it('rejects once the entry window has closed, even though the exam is still live', async () => {
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
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))

    expect(result).toEqual(GENERIC)
    expect(mintStudentSession).not.toHaveBeenCalled()
  })

  it('rejects when go_live_at is still null despite status being live (fails closed)', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      exams: [{
        data: { id: 'exam-1', university_id: 'uni-1', status: 'live', go_live_at: null, entry_window_minutes: 10 },
        error: null,
      }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))

    expect(result).toEqual(GENERIC)
    expect(mintStudentSession).not.toHaveBeenCalled()
  })
```

Also update the two existing passing tests in this `describe` block ("mints a session and redirects…" and "clears the matric number attempt history…") — their mocked `exams` response currently only has `{ id: 'exam-1', university_id: 'uni-1', status: 'live' }`. Add `go_live_at: new Date().toISOString(), entry_window_minutes: 10` to that object in both places so they still represent a genuinely-open window (go-live just now, 10-minute window) — otherwise Step 3 below will break them.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run lib/actions/studentAuth.test.js -t "entry window"`
Expected: FAIL — both new tests currently mint a session (the check doesn't exist yet).

- [ ] **Step 3: Update `verifyExamAccess`**

In `lib/actions/studentAuth.js`, replace:

```javascript
  const { data: exam } = await adminClient
    .from('exams')
    .select('id, university_id, status')
    .eq('access_code', access_code)
    .maybeSingle()

  if (!exam || exam.status !== 'live') {
    await recordFailedAttempt(adminClient, matric_number, ip)
    return GENERIC_ERROR
  }
```

with:

```javascript
  const { data: exam } = await adminClient
    .from('exams')
    .select('id, university_id, status, go_live_at, entry_window_minutes')
    .eq('access_code', access_code)
    .maybeSingle()

  if (!exam || exam.status !== 'live') {
    await recordFailedAttempt(adminClient, matric_number, ip)
    return GENERIC_ERROR
  }

  // The entry window gates only new starts — it never affects a student
  // already mid-attempt (governed entirely by their own started_at +
  // duration_minutes, checked in lib/actions/attempts.js) and it never
  // auto-closes the exam's status; "Close Exam" stays a deliberate,
  // separate lecturer action. A null go_live_at with status already 'live'
  // shouldn't happen (updateExamStatus stamps it on that exact transition)
  // but is treated as "not yet enterable" rather than "no limit" — fail
  // closed, not open.
  const entryDeadline = exam.go_live_at
    ? new Date(exam.go_live_at).getTime() + exam.entry_window_minutes * 60 * 1000
    : null
  if (!entryDeadline || Date.now() > entryDeadline) {
    await recordFailedAttempt(adminClient, matric_number, ip)
    return GENERIC_ERROR
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/actions/studentAuth.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/studentAuth.js lib/actions/studentAuth.test.js
git commit -m "feat: gate new exam entries by the go-live entry window"
```

---

### Task 5: Server-side duration enforcement in saveAnswer

**Files:**
- Modify: `lib/actions/attempts.js:1-32,84-115` (top-of-file helpers, `saveAnswer`)
- Test: `lib/actions/attempts.test.js`

**Interfaces:**
- Produces: a new `isAttemptOverdue(startedAt, durationMinutes)` helper, exported from nowhere (module-private, used by this task and Task 6) — `(string, number) => boolean`, true once `now > startedAt + durationMinutes*60000 + 60000`. `saveAnswer` now returns `{ error: '...', timeExpired: true }` instead of proceeding, once overdue. Task 7 (client) consumes the `timeExpired` field.

- [ ] **Step 1: Write the failing test**

Add to `lib/actions/attempts.test.js`'s `describe('saveAnswer', ...)` block, following this file's existing mock conventions (see `describe('submitExam', ...)` for the `authUserWith`/attempt-mock shape already used):

```javascript
  it('rejects a save once the attempt is past its deadline plus grace period', async () => {
    const startedAt = new Date(Date.now() - 61 * 60 * 1000).toISOString() // 61 min ago
    const supabase = createMockSupabaseClient({
      attempts: [
        { data: { id: 'attempt-1', status: 'in_progress', started_at: startedAt, exams: { duration_minutes: 60 } }, error: null },
      ],
    })
    supabase.auth.getUser.mockResolvedValue(authUserWith('exam_access', 'exam-1'))
    createClient.mockResolvedValue(supabase)

    const result = await saveAnswer('attempt-1', 'q1', 'a')

    expect(result).toEqual({ error: 'Time is up — submitting your exam…', timeExpired: true })
    expect(supabase.from).not.toHaveBeenCalledWith('responses')
  })

  it('still allows a save within the grace period just past the deadline', async () => {
    const startedAt = new Date(Date.now() - 60 * 60 * 1000 - 30 * 1000).toISOString() // 60 min 30s ago — inside the 60s grace
    const supabase = createMockSupabaseClient({
      attempts: [
        { data: { id: 'attempt-1', status: 'in_progress', started_at: startedAt, exams: { duration_minutes: 60 } }, error: null },
      ],
      responses: [{ data: null, error: null }],
    })
    supabase.auth.getUser.mockResolvedValue(authUserWith('exam_access', 'exam-1'))
    createClient.mockResolvedValue(supabase)

    const result = await saveAnswer('attempt-1', 'q1', 'a')

    expect(result).toEqual({ ok: true })
  })
```

- [ ] **Step 2: Run tests to verify the first one fails**

Run: `npx vitest run lib/actions/attempts.test.js -t "deadline"`
Expected: FAIL — `saveAnswer` currently has no time check, so it proceeds and returns `{ ok: true }` instead of the expected rejection.

- [ ] **Step 3: Add the `isAttemptOverdue` helper**

In `lib/actions/attempts.js`, add after the existing `hasExamAccessFor` function (after line 32, before the `startExam` section comment):

```javascript
// Server-side backstop for each student's own answering-time limit. The
// visible countdown/auto-submit in ExamInterface.js is client-side
// JavaScript — a student who disables it via devtools could otherwise keep
// saving answers indefinitely, as long as the exam overall stays 'live'.
// submitExam is deliberately NOT gated by this — it must always be
// callable, since it's the only way out of the time-over state.
const SUBMISSION_GRACE_MS = 60 * 1000

function isAttemptOverdue(startedAt, durationMinutes) {
  const deadline = new Date(startedAt).getTime() + durationMinutes * 60 * 1000 + SUBMISSION_GRACE_MS
  return Date.now() > deadline
}
```

- [ ] **Step 4: Update `saveAnswer`**

Replace:

```javascript
  // Ownership + status check
  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, status')
    .eq('id', attemptId)
    .eq('student_id', user.id)
    .single()

  if (!attempt)                         return { error: 'Attempt not found.' }
  if (attempt.status !== 'in_progress') return { error: 'Exam already submitted.' }

  const { error } = await supabase
```

with:

```javascript
  // Ownership + status check
  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, status, started_at, exams:exam_id ( duration_minutes )')
    .eq('id', attemptId)
    .eq('student_id', user.id)
    .single()

  if (!attempt)                         return { error: 'Attempt not found.' }
  if (attempt.status !== 'in_progress') return { error: 'Exam already submitted.' }
  if (isAttemptOverdue(attempt.started_at, attempt.exams.duration_minutes)) {
    return { error: 'Time is up — submitting your exam…', timeExpired: true }
  }

  const { error } = await supabase
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/actions/attempts.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/attempts.js lib/actions/attempts.test.js
git commit -m "feat: enforce per-student exam duration server-side in saveAnswer"
```

---

### Task 6: Lazy auto-submit for abandoned overdue attempts

**Files:**
- Modify: `lib/actions/attempts.js:36-79` (`startExam`)
- Test: `lib/actions/attempts.test.js`

**Interfaces:**
- Consumes: Task 5's `isAttemptOverdue` helper, `submitExam` (already exported in this same file, called directly).
- Produces: `startExam`'s resume branch auto-submits and returns `{ error: 'Your exam time has ended — it has been submitted automatically.' }` instead of `{ attemptId }` when the existing in-progress attempt is overdue.

- [ ] **Step 1: Write the failing test**

Add to `lib/actions/attempts.test.js`'s `describe('startExam', ...)` block:

```javascript
  it('auto-submits and returns an error when resuming an attempt past its deadline', async () => {
    const startedAt = new Date(Date.now() - 61 * 60 * 1000).toISOString() // 61 min ago, well past a 60-min exam + grace
    const supabase = createMockSupabaseClient({
      // submitExam queries `exams` a second time internally (for pass_mark),
      // separately from startExam's own exam fetch above it — two entries,
      // not one, or the second call starves the mock queue.
      exams: [
        { data: { id: 'exam-1', status: 'live', university_id: 'uni-1', duration_minutes: 60 }, error: null }, // startExam's own exam fetch
        { data: { pass_mark: 50 }, error: null }, // submitExam's internal pass_mark fetch
      ],
      attempts: [
        { data: { id: 'attempt-1', status: 'in_progress', started_at: startedAt }, error: null }, // existing-attempt lookup
        { data: { id: 'attempt-1', exam_id: 'exam-1', status: 'in_progress', student_id: 'stu-1' }, error: null }, // submitExam's own attempt fetch
        { data: null, error: null }, // submitExam's attempt status update
      ],
      exam_questions: [{ data: [], error: null }],
      responses: [{ data: [], error: null }],
    })
    supabase.auth.getUser.mockResolvedValue(authUserWith('exam_access', 'exam-1'))
    createClient.mockResolvedValue(supabase)
    // submitExam's results insert always goes through the admin client, never
    // the student-session client above — queue it separately here.
    createAdminClient.mockReturnValue(createMockSupabaseClient({ results: [{ data: null, error: null }] }))

    const result = await startExam('exam-1')

    expect(result).toEqual({ error: 'Your exam time has ended — it has been submitted automatically.' })
    const attemptsBuilder = supabase.from.mock.results[2].value // submitExam's attempts.update call
    expect(attemptsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'submitted' }))
  })

  it('resumes normally when the existing in-progress attempt is still within its deadline', async () => {
    const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5 min ago, well within a 60-min exam
    const supabase = createMockSupabaseClient({
      exams: [
        { data: { id: 'exam-1', status: 'live', university_id: 'uni-1', duration_minutes: 60 }, error: null },
      ],
      attempts: [
        { data: { id: 'attempt-1', status: 'in_progress', started_at: startedAt }, error: null },
      ],
    })
    supabase.auth.getUser.mockResolvedValue(authUserWith('exam_access', 'exam-1'))
    createClient.mockResolvedValue(supabase)

    const result = await startExam('exam-1')

    expect(result).toEqual({ attemptId: 'attempt-1' })
  })
```

Note: `createAdminClient` is already mocked at the top of this test file (`vi.mock('@/lib/supabase/admin', ...)`) — the first test above needs `createAdminClient.mockReturnValue(...)` set up because it exercises `submitExam` internally (called by `startExam`), and `submitExam` uses the admin client for its `results` insert.

- [ ] **Step 2: Run tests to verify the first one fails**

Run: `npx vitest run lib/actions/attempts.test.js -t "auto-submits"`
Expected: FAIL — `startExam` currently has no overdue check, so it returns `{ attemptId: 'attempt-1' }` instead of the expected auto-submit error.

- [ ] **Step 3: Update `startExam`**

Replace:

```javascript
  // Verify exam is live and accessible to this student (RLS handles access check)
  const { data: exam } = await supabase
    .from('exams')
    .select('id, status, university_id')
    .eq('id', examId)
    .eq('university_id', user.university_id)
    .single()

  if (!exam) return { error: 'Exam not found.' }
  if (exam.status !== 'live') return { error: 'This exam is not currently active.' }

  // Check for an existing attempt — resume if in_progress, block if done
  const { data: existing } = await supabase
    .from('attempts')
    .select('id, status')
    .eq('exam_id', examId)
    .eq('student_id', user.id)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'in_progress') return { attemptId: existing.id }
    return { error: 'You have already submitted this exam.' }
  }
```

with:

```javascript
  // Verify exam is live and accessible to this student (RLS handles access check)
  const { data: exam } = await supabase
    .from('exams')
    .select('id, status, university_id, duration_minutes')
    .eq('id', examId)
    .eq('university_id', user.university_id)
    .single()

  if (!exam) return { error: 'Exam not found.' }
  if (exam.status !== 'live') return { error: 'This exam is not currently active.' }

  // Check for an existing attempt — resume if in_progress, block if done
  const { data: existing } = await supabase
    .from('attempts')
    .select('id, status, started_at')
    .eq('exam_id', examId)
    .eq('student_id', user.id)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'in_progress') {
      // A student who closed the tab and never called submitExam again
      // would otherwise leave this attempt stuck in_progress forever, with
      // no result. Rather than a background job, the next time anyone
      // looks for this attempt (here, on resume) is the natural place to
      // notice it's overdue and finish it.
      if (isAttemptOverdue(existing.started_at, exam.duration_minutes)) {
        await submitExam(existing.id)
        return { error: 'Your exam time has ended — it has been submitted automatically.' }
      }
      return { attemptId: existing.id }
    }
    return { error: 'You have already submitted this exam.' }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/actions/attempts.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/attempts.js lib/actions/attempts.test.js
git commit -m "feat: lazily auto-submit abandoned attempts past their deadline on resume"
```

---

### Task 7: Client-side handling of a time-expired save

**Files:**
- Modify: `components/student/ExamInterface.js:145-155` (`handleAnswerChange`)

**Interfaces:**
- Consumes: Task 5's `saveAnswer` returning `{ error, timeExpired: true }`.

- [ ] **Step 1: Update `handleAnswerChange`**

Replace:

```javascript
  // ── Answer save (debounced) ─────────────────────────────────────────────────
  const handleAnswerChange = useCallback((questionId, value) => {
    dispatch({ type: 'SET_ANSWER', questionId, value })
    setSaveStatus('saving')
    clearTimeout(saveTimers.current[questionId])
    saveTimers.current[questionId] = setTimeout(async () => {
      await saveAnswer(attemptId, questionId, value)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(null), 2000)
    }, 800)
  }, [attemptId])
```

with:

```javascript
  // ── Answer save (debounced) ─────────────────────────────────────────────────
  const handleAnswerChange = useCallback((questionId, value) => {
    dispatch({ type: 'SET_ANSWER', questionId, value })
    setSaveStatus('saving')
    clearTimeout(saveTimers.current[questionId])
    saveTimers.current[questionId] = setTimeout(async () => {
      const result = await saveAnswer(attemptId, questionId, value)
      // The server is the source of truth on time, not this component's
      // local countdown — if it says time's up (e.g. the local timer was
      // tampered with, or the two clocks drifted), funnel into the same
      // submit flow the countdown hitting zero already uses, rather than
      // just showing a failed-save error.
      if (result?.timeExpired && !autoSubmitted.current) {
        autoSubmitted.current = true
        toast.info('Time is up — submitting your exam…')
        doSubmit(true)
        return
      }
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(null), 2000)
    }, 800)
  }, [attemptId]) // eslint-disable-line
```

- [ ] **Step 2: Run `npx next build`**

Run: `npx next build`
Expected: succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add components/student/ExamInterface.js
git commit -m "feat: trigger submit flow when the server reports time expired"
```

---

### Task 8: Dual-mode /lab/{code} entry page

**Files:**
- Create: `app/lab/[code]/MatricEntryForm.js`
- Modify: `app/lab/[code]/page.js`
- Modify: `app/lab/[code]/EndSessionButton.js`
- Modify: `lib/actions/studentAuth.js:141-151` (`endStudentSession`)

**Interfaces:**
- Consumes: `verifyExamAccess` (unchanged signature — Task 4's action, called from a new UI surface).
- Produces: `endStudentSession(code?)` now takes an optional matric access code and redirects back to that exam's lobby instead of always the generic `/lab` page.

- [ ] **Step 1: Update `endStudentSession`**

In `lib/actions/studentAuth.js`, replace:

```javascript
export async function endStudentSession() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/lab')
}
```

with:

```javascript
export async function endStudentSession(code) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // A kiosk lab machine is pre-loaded once, for the whole sitting, to this
  // exam's own /lab/{code} URL — the next student at the same machine
  // should land back on that same matric-entry form, not a generic page
  // that makes them re-discover the code.
  redirect(code ? `/lab/${code}` : '/lab')
}
```

- [ ] **Step 2: Create `app/lab/[code]/MatricEntryForm.js`**

```javascript
'use client'

import { useActionState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { verifyExamAccess } from '@/lib/actions/studentAuth'

export function MatricEntryForm({ code }) {
  const [state, formAction, isPending] = useActionState(verifyExamAccess, null)

  return (
    <form action={formAction} className="space-y-5">
      {/* The code is already known from the URL this machine was
          pre-loaded to — the student only ever types their matric number. */}
      <input type="hidden" name="access_code" value={code} />

      <div>
        <label htmlFor="matric_number" className="block text-sm font-medium text-text-primary mb-2 text-center">
          Enter your Matric Number to begin
        </label>
        <input
          id="matric_number"
          name="matric_number"
          type="text"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. CSC/2021/001"
          className="w-full text-center text-lg font-mono font-semibold rounded-2xl border-2 border-border focus:border-primary px-4 py-4 focus:outline-none transition-colors text-text-primary"
        />
        {state?.error && (
          <p className="text-xs text-danger mt-2 text-center">{state.error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full flex items-center justify-center gap-2 py-3.5 bg-primary text-white text-sm font-semibold rounded-2xl hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isPending
          ? <><Loader2 size={16} className="animate-spin" /> Verifying…</>
          : <><ArrowRight size={16} /> Enter Exam</>
        }
      </button>
    </form>
  )
}
```

- [ ] **Step 3: Update `app/lab/[code]/EndSessionButton.js`**

Replace:

```javascript
export function EndSessionButton() {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    await endStudentSession()
  }
```

with:

```javascript
export function EndSessionButton({ code }) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    await endStudentSession(code)
  }
```

- [ ] **Step 4: Rewrite `app/lab/[code]/page.js`**

Replace the full file content with:

```javascript
import { notFound, redirect } from 'next/navigation'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MatricEntryForm } from './MatricEntryForm'
import { LabStartButton } from './LabStartButton'
import { EndSessionButton } from './EndSessionButton'
import { Clock, BookOpen, FileText, Monitor } from 'lucide-react'

export const metadata = { title: 'Exam — OEMS Lab' }

export default async function LabLobbyPage({ params }) {
  const { code } = await params
  const upperCode = code.toUpperCase()

  // A lab machine can be pre-loaded to this URL before anyone has entered a
  // matric number — an unauthenticated visitor has no RLS-visible session,
  // so this initial lookup must use the admin client, the same way
  // verifyExamAccess does. Only the exam's existence is checked here;
  // nothing sensitive (instructions, questions, status detail) is exposed
  // before authentication.
  const adminClient = createAdminClient()
  const { data: examBasic } = await adminClient
    .from('exams')
    .select('id')
    .eq('access_code', upperCode)
    .maybeSingle()

  if (!examBasic) notFound()

  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()

  const isAuthedForThisExam =
    authUser?.app_metadata?.session_channel === 'exam_access' &&
    authUser?.app_metadata?.verified_exam_id === examBasic.id

  if (!isAuthedForThisExam) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm">
          <div className="flex items-center justify-center gap-2 mb-6">
            <span className="flex items-center gap-1.5 bg-primary text-white text-xs font-semibold px-3 py-1.5 rounded-full">
              <Monitor size={12} />
              Lab Session · Code: {upperCode}
            </span>
          </div>
          <MatricEntryForm code={upperCode} />
        </div>
      </div>
    )
  }

  // Authenticated for this specific exam — requireRole re-confirms the
  // role/active-account guard (redirects to /login if that somehow doesn't
  // hold), then everything below is unchanged from before this task.
  const user = await requireRole('student')

  const { data: exam } = await supabase
    .from('exams')
    .select(`
      id, title, status, exam_type, academic_session, semester,
      duration_minutes, pass_mark, instructions,
      show_calculator, tips,
      courses!course_id ( course_code, course_title )
    `)
    .eq('access_code', upperCode)
    .single()

  if (!exam) notFound()

  // Must be live
  if (exam.status !== 'live') {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <Monitor size={48} className="mx-auto mb-4 text-text-muted" />
          <h1 className="text-xl font-bold text-text-primary mb-2">Exam not active</h1>
          <p className="text-sm text-text-muted">
            This exam is currently <strong>{exam.status}</strong>. Wait for your lecturer to open it.
          </p>
        </div>
      </div>
    )
  }

  // Check for existing attempt
  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, status')
    .eq('exam_id', exam.id)
    .eq('student_id', user.id)
    .maybeSingle()

  if (attempt?.status === 'in_progress') {
    redirect(`/lab/${upperCode}/attempt/${attempt.id}`)
  }

  const { data: examQuestions } = await supabase
    .from('exam_questions')
    .select('marks')
    .eq('exam_id', exam.id)

  const questionCount = examQuestions?.length ?? 0
  const totalMarks    = (examQuestions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)
  const alreadyDone   = attempt && attempt.status !== 'in_progress'

  const EXAM_TYPE_LABELS = {
    ca: 'Continuous Assessment', mid_semester: 'Mid-Semester Test', end_of_semester: 'End of Semester Examination',
  }

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-xl">
        {/* Lab badge */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="flex items-center gap-1.5 bg-primary text-white text-xs font-semibold px-3 py-1.5 rounded-full">
            <Monitor size={12} />
            Lab Session · Code: {upperCode}
          </span>
        </div>

        {/* Exam header */}
        <div className="text-center mb-8">
          <p className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">
            {exam.courses?.course_code} · {EXAM_TYPE_LABELS[exam.exam_type] ?? exam.exam_type}
          </p>
          <h1 className="text-3xl font-bold text-text-primary tracking-tight mb-1">{exam.title}</h1>
          <p className="text-sm text-text-secondary">
            {exam.academic_session} · {exam.semester === 'first' ? 'First' : 'Second'} Semester
          </p>
          {user.matric_number && (
            <p className="font-mono text-xs text-text-muted mt-2">
              {user.matric_number} · {user.full_name}
            </p>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-surface border border-border rounded-xl p-4 text-center">
            <Clock size={20} className="mx-auto mb-2 text-text-muted" />
            <p className="text-2xl font-bold text-text-primary">{exam.duration_minutes}</p>
            <p className="text-xs text-text-muted mt-0.5">minutes</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 text-center">
            <BookOpen size={20} className="mx-auto mb-2 text-text-muted" />
            <p className="text-2xl font-bold text-text-primary">{questionCount}</p>
            <p className="text-xs text-text-muted mt-0.5">questions</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 text-center">
            <FileText size={20} className="mx-auto mb-2 text-text-muted" />
            <p className="text-2xl font-bold text-text-primary">{totalMarks}</p>
            <p className="text-xs text-text-muted mt-0.5">marks · pass {exam.pass_mark}%</p>
          </div>
        </div>

        {/* Instructions */}
        {exam.instructions && (
          <div className="bg-surface border border-border rounded-xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-text-primary mb-2">Instructions</h2>
            <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">
              {exam.instructions}
            </p>
          </div>
        )}

        {/* CTA */}
        <div className="text-center">
          {alreadyDone ? (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">You have already submitted this exam.</p>
              <EndSessionButton code={upperCode} />
            </div>
          ) : (
            <LabStartButton examId={exam.id} labCode={upperCode} />
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run `npm test` and `npx next build`**

Run: `npm test && npx next build`
Expected: both succeed. There is no existing test file for `app/lab/[code]/page.js` or `endStudentSession` — this task is verified by build success plus a manual dev-server check (start `npm run dev`, confirm it boots without error; full end-to-end verification of the auth branching needs a real Supabase session, out of reach of a build check alone — say exactly what was and wasn't verified in the report, per this session's established convention).

- [ ] **Step 6: Commit**

```bash
git add app/lab/[code]/MatricEntryForm.js app/lab/[code]/page.js app/lab/[code]/EndSessionButton.js lib/actions/studentAuth.js
git commit -m "feat: dual-mode /lab/{code} entry page for pre-loaded lab machines"
```
