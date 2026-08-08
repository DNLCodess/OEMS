# Exam Access Control Fix — Design

## Problem

Two related gaps, found while reviewing the credential-less student-auth work for how it behaves with multiple exams:

1. **No lecturer-facing way to restrict who can take an exam.** The database already has an `exam_access` table and an enforced RLS policy for it (`exam_owner_manage_access`, `student_read_accessible_exams` — `supabase/schema.sql`) — if a lecturer adds rows, only those students can even see the exam; with zero rows, it's open to every student in the university. But there is no server action or UI anywhere that lets a lecturer actually populate that table. The mechanism exists and is enforced; nobody can reach it.

2. **The credential-less exam-access session isn't bound to a specific exam.** `verifyExamAccess` (`lib/actions/studentAuth.js`) mints a session tagged with a generic `session_channel: 'exam_access'` in the student's `app_metadata` (`lib/supabase/studentSession.js`'s `mintStudentSession`). `startExam(examId)` (`lib/actions/attempts.js`) only checks that this tag is present, plus that the exam is live and in the same university — it never checks that *this* session was verified against *this* exam. Because of gap 1, nothing else fills that hole today either. Net effect: a student who correctly enters Exam A's access code can currently call `startExam` on Exam B — a different live exam in the same university — without ever knowing Exam B's code.

Both gaps are closed by the same piece of work: bind the session to the exam it was verified for, and give lecturers a real way to use the existing `exam_access` allow-list.

## Non-goals

- No enrollment-tracking table. There's a real edge case (a student retaking a failed course, now at a different level than the course's nominal level) that rules out pre-filtering the allow-list candidate pool by department/level — the pool is deliberately the whole university's active students, searchable, not derived from any assumed enrollment relationship.
- `saveAnswer`/`submitExam` are not changed to check the specific exam binding — only `startExam` is. See "Session-exam binding" below for why that's sufficient.

## Session-exam binding

`mintStudentSession(email, channel, examId = null)` gains a third, optional argument. When present, it's written into `app_metadata` as `verified_exam_id` in the same `admin.updateUserById` call that already sets `session_channel` — no extra round trip.

`verifyExamAccess` passes the exam's own `id` when minting (it already has the exam row in hand, looked up by access code). `verifyResultAccess` continues to omit it — a result-lookup session has no single exam to bind to.

`startExam(examId)` in `lib/actions/attempts.js` currently has:

```js
function hasExamAccessChannel(authUser) {
  return authUser?.app_metadata?.session_channel === 'exam_access'
}
```

This becomes exam-aware:

```js
function hasExamAccessFor(authUser, examId) {
  return authUser?.app_metadata?.session_channel === 'exam_access'
    && authUser?.app_metadata?.verified_exam_id === examId
}
```

`startExam` calls `hasExamAccessFor(authUser, examId)` instead of the old channel-only check, returning the same `EXAM_ACCESS_REQUIRED_ERROR` on mismatch — same generic message, no information leak about which part failed.

`saveAnswer` and `submitExam` are **not** changed — they keep checking the coarse channel only (`session_channel === 'exam_access'`, no exam-id comparison). This is deliberately sufficient: by the time an attempt row exists, it was only created via `startExam`'s (now exam-bound) gate, and ownership is separately enforced by `attempts.student_id = auth.uid()`. Re-checking the exam binding on every autosave would add cost without closing any additional hole.

**Why this also answers "how are concurrent exams handled":** the binding only gates *creating* a new attempt. Resuming an existing `in_progress` attempt happens via the attempt's own id (`app/lab/[code]/page.js`'s existing-attempt lookup), never by re-calling `startExam`. So a student can legitimately hold two live attempts at once (two different courses examined the same week) — each was bound to its own exam at creation time, and neither's `saveAnswer`/`submitExam` re-checks the binding, so they don't interfere with each other even if the student's session is later re-minted for a third exam in another tab.

## Lecturer allow-list UI

New panel on the lecturer's exam detail page (`app/lecturer/exams/[id]/page.js`), alongside the existing `AccessCodePanel`: an `ExamAccessPanel` component.

- **Search:** a text input (matric number or name), scoped to active students in the lecturer's own university — not filtered by department or level, per the retake edge case above.
- **Current list:** students currently in `exam_access` for this exam, each with a "Remove" action. Empty list is shown with an explicit "Open to all students" state, since zero rows has that exact RLS meaning — this needs to be visible, not just implied by an empty list.
- **Add:** selecting a search result inserts an `exam_access` row.

Two new server actions in `lib/actions/exams.js`, following the existing `requireRole('lecturer')` + `getOwnedExam(supabase, examId, user.id, user.university_id)` ownership-check pattern already used by `generateAccessCode`:

- `searchEligibleStudents(examId, query)` — returns matching active students (`role = 'student'`, `university_id` = lecturer's own, matric number or name `ilike` the query), each flagged with whether they're already in the exam's `exam_access` list.
- `addExamAccessStudent(examId, studentId)` / `removeExamAccessStudent(examId, studentId)` — insert/delete a single `exam_access` row. `exam_access` already has `UNIQUE(exam_id, user_id)`; a duplicate add is treated as a no-op success, not a surfaced error (the RLS policy `exam_owner_manage_access` already restricts this to the exam's own creator, so no additional ownership check is needed beyond what `getOwnedExam` does for the `examId` itself).

## Testing

- `lib/actions/attempts.test.js`: extend the existing `startExam` coverage with cases for `verified_exam_id` matching, mismatched, and absent (the pre-existing "wrong channel" and "missing metadata" cases stay as they are — this adds a same-channel-wrong-exam case).
- `lib/actions/exams.test.js`: new tests for `searchEligibleStudents` (university-scoped, matches by matric or name, flags existing members), `addExamAccessStudent` (inserts, duplicate is a no-op), `removeExamAccessStudent` (deletes, ownership enforced via the existing `getOwnedExam` helper).
- No RLS/migration changes are needed — both `exam_access` and its policies already exist; this is purely an application-layer feature on top of them.
