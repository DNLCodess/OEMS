# Lecturer Question-Bank Department Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lecturer can only see and reuse (in the exam-builder question picker) non-archived questions belonging to courses in their own department, not the whole university — closing an over-broad RLS sharing policy — while their own questions stay visible/manageable regardless of department.

**Architecture:** A new Postgres RLS policy on `question_bank` (replacing an existing, over-broad one) is the actual enforcement point; it requires a new `auth_department_id()` helper following the existing `auth_university_id()`/`auth_role()` pattern. A second, explicit application-layer check is added in `addQuestionToExam` (`lib/actions/exams.js`) as defense-in-depth, matching the existing ownership-recheck convention already used elsewhere in that file's sibling module (`lib/actions/questions.js`).

**Tech Stack:** Supabase/PostgreSQL (RLS policies, manually-applied migrations per this repo's convention), Next.js server actions, vitest (existing `environment: 'node'` config, `tests/helpers/supabaseMock.js` mock client).

## Global Constraints

- Migrations in this repo are written as SQL files under `supabase/migrations/` and applied manually via the Supabase Dashboard SQL editor — there is no automated migration runner to invoke. Follow the naming/header convention in `supabase/migrations/README.md`: filename `YYYYMMDDHHMMSS_short_description.sql`, and the file's own top comment records why (no separate "Applied:" line — that gets added manually by whoever runs it in the dashboard, not by this plan).
- No lecturer-course assignment table — department-level scoping only, using the existing `users.department_id` and `courses.department_id` columns. Do not build a course-assignment feature.
- A lecturer with `department_id IS NULL` must see zero shared (non-owned) questions — fail closed, not fail open.
- `lecturer_manage_own_questions` (own-question ALL policy) and `school_admin_read_questions` are untouched by this plan.
- No changes to `app/lecturer/exams/[id]/page.js`'s `bankQuestions` query — RLS alone governs what that read returns (see spec §3 for why duplicating the filter there would be both redundant and error-prone).

---

### Task 1: RLS migration — department-scoped question sharing

**Files:**
- Create: `supabase/migrations/20260811120000_lecturer_department_question_scope.sql`

**Interfaces:**
- Produces: `auth_department_id()` SQL function (usable by any future policy needing the current user's department), and the `lecturer_read_department_questions` policy replacing `lecturer_read_university_questions` on `question_bank`.

There is no automated test harness for RLS policies in this repo (no other migration has one — verified: none of the 9 existing files under `supabase/migrations/` include a test). This task's correctness is verified by manual application and a query check, per Step 2 below, matching this repo's established pattern for RLS changes.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260811120000_lecturer_department_question_scope.sql`:

```sql
-- Lecturers could read every non-archived question university-wide via
-- lecturer_read_university_questions, with no course/department boundary.
-- Narrowing to department-level sharing: a lecturer can now only see (and
-- reuse, via the exam-builder picker) questions belonging to a course in
-- their own department. Own questions stay visible/manageable regardless
-- of department via the untouched lecturer_manage_own_questions ALL policy
-- (Postgres RLS combines multiple permissive policies for one command with
-- OR). A lecturer with no department_id set sees no shared questions —
-- fails closed, not open.
-- Applied: <fill in the date you run this>

-- Helper: get current user's department_id (same pattern as
-- auth_university_id()/auth_role()).
CREATE OR REPLACE FUNCTION auth_department_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT department_id FROM public.users WHERE id = auth.uid()
$$;

DROP POLICY IF EXISTS "lecturer_read_university_questions" ON question_bank;

CREATE POLICY "lecturer_read_department_questions" ON question_bank
  FOR SELECT
  USING (
    university_id = auth_university_id()
    AND auth_role() = 'lecturer'
    AND is_archived = FALSE
    AND course_id IN (SELECT id FROM courses WHERE department_id = auth_department_id())
  );
```

- [ ] **Step 2: Document the manual verification query**

This step produces no file change — it's the verification a human runs after applying the migration in the Supabase Dashboard SQL editor. Record it in the same migration file as a trailing comment block (append to the file from Step 1):

```sql

-- Manual verification (run as any authenticated lecturer via the app, or
-- via `SET ROLE`/impersonation in the SQL editor — do not run as the
-- postgres/service-role user, which bypasses RLS entirely):
--
--   SELECT id, course_id FROM question_bank WHERE is_archived = FALSE;
--
-- Expected: only rows where course_id belongs to a course in the lecturer's
-- own department, plus any row where created_by = the lecturer's own id
-- (regardless of that row's department). A lecturer with department_id
-- NULL should see only their own created_by rows.
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260811120000_lecturer_department_question_scope.sql
git commit -m "feat: scope lecturer question-bank sharing to department"
```

---

### Task 2: Application-layer defense-in-depth check in `addQuestionToExam`

**Files:**
- Modify: `lib/actions/exams.js:113-158` (the `addQuestionToExam` function)
- Test: `lib/actions/exams.test.js`

**Interfaces:**
- Consumes: `user.department_id` (already returned by `requireRole('lecturer')` — `lib/dal.js:20` already selects this column, no change needed there).
- No change to `addQuestionToExam`'s own signature (`examId, questionId`) or its success/error return shapes, beyond one new possible error message: `{ error: "You don't have access to this question." }`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/actions/exams.test.js`, after the existing `describe('generateAccessCode', ...)` block's closing `})` (or anywhere at the top level alongside the other `describe` blocks — match the file's existing style):

```js
describe('addQuestionToExam', () => {
  it('returns an error when the exam is not owned by this lecturer', async () => {
    const supabase = createMockSupabaseClient({ exams: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await addQuestionToExam('exam-1', 'q-1')

    expect(result).toEqual({ error: 'Exam not found.' })
  })

  it('returns an error when the exam is live or closed', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1', status: 'live' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await addQuestionToExam('exam-1', 'q-1')

    expect(result).toEqual({ error: 'Cannot add questions to a live or closed exam.' })
  })

  it('returns an error when the question is not visible (RLS returned no row)', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1', status: 'draft' }, error: null }],
      question_bank: [{ data: null, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await addQuestionToExam('exam-1', 'q-1')

    expect(result).toEqual({ error: 'Question not found.' })
  })

  it('rejects a question from a different department that this lecturer did not create', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1', status: 'draft' }, error: null }],
      question_bank: [{
        data: {
          id: 'q-1', type: 'mcq', body: 'Q', difficulty: 'medium', course_id: 'course-1',
          created_by: 'lect-2',
          courses: { course_code: 'CSC 301', department_id: 'dept-other' },
        },
        error: null,
      }],
    })
    createClient.mockResolvedValue(supabase)
    requireRole.mockResolvedValue({ ...lecturer, department_id: 'dept-1' })

    const result = await addQuestionToExam('exam-1', 'q-1')

    expect(result).toEqual({ error: "You don't have access to this question." })
  })

  it('allows a question from the same department created by a different lecturer', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1', status: 'draft' }, error: null }],
      question_bank: [{
        data: {
          id: 'q-1', type: 'mcq', body: 'Q', difficulty: 'medium', course_id: 'course-1',
          created_by: 'lect-2',
          courses: { course_code: 'CSC 301', department_id: 'dept-1' },
        },
        error: null,
      }],
      exam_questions: [
        { data: [], error: null },
        { data: { id: 'eq-1', order_index: 0, marks: 1, question_id: 'q-1' }, error: null },
      ],
    })
    createClient.mockResolvedValue(supabase)
    requireRole.mockResolvedValue({ ...lecturer, department_id: 'dept-1' })

    const result = await addQuestionToExam('exam-1', 'q-1')

    expect(result.error).toBeUndefined()
    expect(result.examQuestion.id).toBe('eq-1')
  })

  it('allows a lecturer\'s own question regardless of department', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1', status: 'draft' }, error: null }],
      question_bank: [{
        data: {
          id: 'q-1', type: 'mcq', body: 'Q', difficulty: 'medium', course_id: 'course-1',
          created_by: 'lect-1',
          courses: { course_code: 'CSC 301', department_id: 'dept-other' },
        },
        error: null,
      }],
      exam_questions: [
        { data: [], error: null },
        { data: { id: 'eq-1', order_index: 0, marks: 1, question_id: 'q-1' }, error: null },
      ],
    })
    createClient.mockResolvedValue(supabase)
    requireRole.mockResolvedValue({ ...lecturer, department_id: 'dept-1' })

    const result = await addQuestionToExam('exam-1', 'q-1')

    expect(result.error).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run lib/actions/exams.test.js`
Expected: the three new tests specific to this task — "rejects a question from a different department...", "allows a question from the same department...", "allows a lecturer's own question..." — FAIL. The other three (exam-not-owned, live/closed, question-not-found) already pass against the current code since they don't exercise the new department check; confirm they still pass (they test existing behavior, listed here for completeness/regression coverage, not because they're expected to fail).

- [ ] **Step 3: Implement the check**

In `lib/actions/exams.js`, replace the question-fetch block (currently lines 123-132):

```js
  // Verify question belongs to this university and isn't archived
  const { data: question } = await supabase
    .from('question_bank')
    .select('id, type, body, difficulty, course_id, courses(course_code)')
    .eq('id', questionId)
    .eq('university_id', user.university_id)
    .eq('is_archived', false)
    .single()

  if (!question) return { error: 'Question not found.' }
```

with:

```js
  // Verify question belongs to this university and isn't archived
  const { data: question } = await supabase
    .from('question_bank')
    .select('id, type, body, difficulty, course_id, created_by, courses(course_code, department_id)')
    .eq('id', questionId)
    .eq('university_id', user.university_id)
    .eq('is_archived', false)
    .single()

  if (!question) return { error: 'Question not found.' }

  // Defense-in-depth: RLS (lecturer_read_department_questions) already
  // scopes the fetch above to the lecturer's own department or their own
  // questions, so this should be unreachable in practice — but it gives a
  // specific, correct rejection reason rather than silently relying on an
  // RLS misconfiguration never happening, matching the ownership recheck
  // pattern in lib/actions/questions.js's updateQuestion/archiveQuestion.
  const sameDepartment = question.courses?.department_id && question.courses.department_id === user.department_id
  if (question.created_by !== user.id && !sameDepartment) {
    return { error: "You don't have access to this question." }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/actions/exams.test.js`
Expected: PASS, all tests in the file including the 6 new ones in `describe('addQuestionToExam', ...)`.

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

Run: `npx vitest run`
Expected: PASS (all prior tests plus the new ones).

- [ ] **Step 6: Commit**

```bash
git add lib/actions/exams.js lib/actions/exams.test.js
git commit -m "feat: reject cross-department questions in addQuestionToExam"
```

---

## Self-Review Notes

- **Spec coverage:** §1 (RLS helper + policy) → Task 1. §2 (app-layer check) → Task 2. §3 (no change to `bankQuestions`) → enforced as a Global Constraint, no task touches that file. Migration risk section is informational only, already surfaced to the human in the spec/design conversation — no task needed.
- **Type/signature consistency:** `question.courses.department_id`, `question.created_by`, `user.department_id` — same field names used consistently in Task 2's implementation and its tests. Test fixtures for `question_bank` responses match the exact shape the real Supabase client would return for the updated `select(...)` string (nested `courses` object, not array — matches the existing single-row `.single()` pattern already used elsewhere in this file for the same kind of embed, e.g. `getOwnedExam`'s non-embedded select and the pre-existing `courses(course_code)` embed being extended, not restructured).
- **No placeholders:** every step has literal code or a literal SQL block; the only bracketed text is `<fill in the date you run this>` inside the migration's own comment, which is intentionally filled in by whoever applies it manually (per this repo's own migration convention — `README.md` describes marking files "Applied: YYYY-MM-DD" by hand), not a plan gap.
