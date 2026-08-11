# Lecturer Question-Bank Department Scoping — Design

## Problem

A lecturer reported being able to see questions in the exam-builder's question picker that aren't theirs. Tracing it: `question_bank`'s RLS policy `lecturer_read_university_questions` (`supabase/schema.sql:403-405`) grants every lecturer read access to every non-archived question **university-wide**, with no course or department boundary — a named, deliberate policy, not an RLS oversight. The exam-builder's picker (`app/lecturer/exams/[id]/page.js:48-53`, feeding `QuestionPickerModal.js`) inherits that scope directly: a Chemistry lecturer can see and reuse a Computer Science lecturer's exam questions.

Mutation is unaffected — `lecturer_manage_own_questions` (own-`created_by`-only) plus app-level ownership re-checks in `updateQuestion`/`archiveQuestion` (`lib/actions/questions.js`) already prevent anyone from editing or deleting a question they didn't create. This design only narrows *read/reuse* sharing.

There is no existing concept of "courses a lecturer teaches" in the schema — no join table records that. `users.department_id` and `courses.department_id` (both already populated columns) are the finest boundary available without first building a lecturer-course assignment feature, which is out of scope here.

## Goal

A lecturer can see and reuse (in the exam-builder picker) any non-archived question belonging to a course in their own department — not the whole university. Their own questions remain visible and manageable regardless of department (unchanged, via the existing ownership policy). A lecturer with no `department_id` set sees no other lecturer's questions (fails closed), not the current broad default.

## Design

### 1. RLS: new helper + narrowed policy

New migration, `supabase/migrations/<timestamp>_lecturer_department_question_scope.sql`:

- `auth_department_id()` — a `STABLE SECURITY DEFINER` SQL function returning the current user's `department_id`, following the exact pattern of the existing `auth_university_id()`/`auth_role()` helpers (`supabase/schema.sql:312-321`).
- Replace `lecturer_read_university_questions` with `lecturer_read_department_questions`:
  ```sql
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
- `lecturer_manage_own_questions` (the `ALL`, own-`created_by` policy) is untouched. Postgres RLS combines multiple permissive policies for the same command with `OR`, so a lecturer's own questions stay visible via that policy even when this one doesn't match (e.g. no department set, or the question's course sits in a different department than the lecturer's own).
- `school_admin_read_questions` is untouched — admin oversight stays university-wide, unaffected by this change.

### 2. Application-layer duplicate check in `addQuestionToExam`

Even though the fetch in `lib/actions/exams.js`'s `addQuestionToExam` already runs under the RLS-respecting session client (`lib/supabase/server.js`'s `createClient()`, not a service-role client) and will naturally return no row for a question outside the lecturer's new visibility scope — making the existing `if (!question) return { error: 'Question not found.' }` already correct — this design adds an explicit, second check for defense-in-depth, matching the existing ownership-recheck convention already used in `updateQuestion`/`archiveQuestion`.

In `lib/actions/exams.js`, extend the existing question fetch (currently lines 124-130) to also select `created_by` and the joined course's `department_id`:

```js
const { data: question } = await supabase
  .from('question_bank')
  .select('id, type, body, difficulty, course_id, created_by, courses(course_code, department_id)')
  .eq('id', questionId)
  .eq('university_id', user.university_id)
  .eq('is_archived', false)
  .single()

if (!question) return { error: 'Question not found.' }

const sameDepartment = question.courses?.department_id && question.courses.department_id === user.department_id
if (question.created_by !== user.id && !sameDepartment) {
  return { error: "You don't have access to this question." }
}
```

`user.department_id` is already available on the `requireRole('lecturer')` result (`lib/dal.js:20` already selects it) — no change needed there. The added `department_id` field on the joined `courses` object is additive to the existing `question_bank` shape returned in `{ examQuestion: { ...examQuestion, question_bank: question } }`; `ExamBuilder.js`'s render already accesses these fields via optional chaining (`qb?.courses?.course_code`, etc.), so the extra field is harmless.

### 3. No change to `bankQuestions` (the picker's read query)

`app/lecturer/exams/[id]/page.js`'s `bankQuestions` query is left as-is (no added `.eq`/`.in` filter). It runs under the same RLS-respecting client; the new RLS policy alone determines which rows it gets back. Explicitly duplicating the department filter here would be redundant *and* wrong if written naively with `.eq()` — it would need to express "own questions OR department match," and getting that OR right in a Supabase Postgrest filter is more error-prone than just trusting RLS, which is the actual, tested source of truth. This is a pure visibility read, not a mutation needing a specific rejection message, so the asymmetry with §2 is intentional: mutations get an explicit, user-facing rejection reason; reads rely on RLS to simply not return rows.

## Migration risk (informational, not a design change)

If any exam that already exists today has a question added by a lecturer in a *different* department (legal under the current, broader policy), that exam's `exam_questions` row will start rendering as a blank entry in `ExamBuilder.js` immediately after this migration is applied — confirmed non-crashing (`ExamBuilder.js:146-153` already uses optional chaining throughout), but the question body/type/course badge will disappear from that row. Given this is a dev-stage app with seeded demo data (per `seeding.md`), this is expected to be a non-issue, but is worth a quick manual check of existing exams before applying the migration to any environment with real user data.

## Non-goals

- No lecturer-course assignment table/feature (true per-course scoping) — explicitly deferred; department-level is the agreed boundary for this design.
- No backfill/data migration for existing cross-department `exam_questions` rows — accepted as the migration risk above, not engineered around.
- No change to student-facing question visibility (`student_read_questions_in_active_attempt`) or school-admin visibility (`school_admin_read_questions`) — both already correctly scoped for their own purposes and untouched by this design.
