# Result Model Simplification — Design

Last of four changes from tonight's system review. The other three (exam access control fix, PCU rebrand, hide remote mode) are already built and merged.

## Problem

Two things the project owner reasoned through tonight, now confirmed:

1. **The manual result-release gate is unnecessary complexity.** It exists to protect against a student seeing a score before a lecturer finishes manually grading essay/short-answer questions. But this university will never administer essay/theory questions via CBT — those stay physical, paper exams. Every question type left in the system (`mcq`, `multi_select`, `true_false`, `fill_blank`) auto-grades instantly on submission, so there's never a "waiting on the lecturer" state to protect against.
2. **OEMS's job ends at producing a result, not managing it long-term.** The university has its own portal/ERP for aggregating results, payments, and registration. OEMS needs to hand off a clean, exportable result set — not host its own release-approval workflow.

## What ships

### 1. Results are visible immediately

`submitExam` (`lib/actions/attempts.js`) sets `released_at` to the current timestamp when it inserts the result row, instead of leaving it `null`. This is the entire mechanism — the existing RLS policy (`student_read_own_released_results`, requires `released_at IS NOT NULL`) needs **no change at all**, since it will now always be satisfied immediately. No migration.

Everything that currently exists *because* release could be delayed becomes dead code once every result is released at creation, and is removed, not left dormant:
- `releaseResults` / `unreleaseResults` (`lib/actions/results.js`) — deleted.
- Release/unrelease buttons and the `allReleased`/`released` columns in `ResultsTable.js` — deleted.
- The "submitted but not yet released" branch in `app/student/exams/[id]/result/page.js` — deleted; a submitted attempt always has a visible result now.
- The `.not('released_at', 'is', null)` filters across the five dashboard/list pages (`app/student/exams/page.js`, `app/student/results/page.js`, `app/student/dashboard/page.js`, `app/admin/dashboard/page.js`, `app/super-admin/dashboard/page.js`, `app/lecturer/dashboard/page.js`) — removed; every result row now qualifies, so the filter was only ever adding a dead WHERE clause.
- The lecturer dashboard's "closed exams with unreleased results" health metric (`app/lecturer/dashboard/page.js`) — deleted; can never be non-zero.

### 2. Essay and short-answer question types removed

Removed from every place a question type is offered, validated, labeled, or rendered:
- `lib/validations/questions.js` — drop `'short_answer'` and `'essay'` from `QUESTION_TYPES`.
- `components/questions/TypeSelector.js` — drop their two option cards.
- `components/questions/QuestionForm.js` — drop the `showShortAnswer`/`showEssayNote` branches.
- `components/questions/QuestionPreview.js`, `components/exams/QuestionPickerModal.js`, `lib/utils.js` — drop their entries from the type-label maps and preview branches.
- `lib/actions/questions.js` — drop the `essay`-specific `correct_answer: null` special case (no longer a reachable type).
- `lib/actions/attempts.js`'s `grade()` — drop the `essay`/`short_answer` branch that returns `{ is_correct: null, marks_awarded: 0 }`; every remaining type always produces a real `is_correct`.

**This removes manual grading as a concept, not just those two types**, because manual grading only ever existed to handle them. Removed entirely, not left dormant:
- `components/lecturer/GradePanel.js` and the `app/lecturer/exams/[id]/results/[attemptId]` route (page + folder) — deleted.
- `updateResponseGrade` and `recalculateResult` (`lib/actions/results.js`) — deleted.
- The `'graded'` value in `attempts.status` usage — the app never sets or checks for it again (attempts go straight from `in_progress` to `submitted`, which is now also final).
- The "needs review" concept in `ResultsTable.js`/`app/lecturer/exams/[id]/results/page.js` (`grading_status`, `attemptsNeedingReview`, the `manualCheck` query against `responses.is_correct IS NULL`) — deleted; with no manual types, `is_correct` is never null, so this can never fire.
- The "View" link from the results table to the now-deleted grade-attempt page — deleted along with it. (The results table becomes purely a read-only leaderboard; there's no per-attempt drill-down page left once grading is gone.)

**Database:** enum values (`question_type` keeps `'essay'`/`'short_answer'` as unused-but-valid; Postgres can't drop enum values without a table-rebuild migration) are left alone — same pattern as tonight's "hide remote mode" work. App-layer-only change, no migration.

**Existing data:** live-checked via the Supabase MCP — the project has exactly one `short_answer` question, attached to one exam, no `essay` questions (this is pre-launch demo data, confirmed discardable). That one question and its `exam_questions` link are deleted as an explicit step of this work — done directly, not delegated, since it's a real data mutation against the live project.

### 3. Export: no new dependencies

Both requested export formats already exist and are kept as-is:
- **Excel-compatible**: `ResultsTable.js`'s existing `exportCSV()` — CSV opens natively in Excel and already includes matric number, name, score, percentage, pass/fail. Once "released"/"grading status" columns are dead (per above), the header row drops those two columns; everything else is unchanged.
- **PDF**: the existing `window.print()` + `print:hidden` stylesheet already produces a clean PDF via the browser's native print-to-PDF — no server-side PDF generation library needed for a small app that doesn't otherwise need one.

## Non-goals

- No change to how MCQ/multi-select/true-false/fill-blank grading works — already correct, untouched.
- No change to `attempts.status` values beyond no longer reaching `'graded'` — `in_progress`/`submitted` stay exactly as they are.
- No new PDF/Excel library, per above.
- No migration — every change here is application code plus one explicit demo-data cleanup.

## Testing

Automated: `lib/actions/attempts.test.js` gets a new assertion that `submitExam`'s result insert includes a non-null `released_at`. There is no existing `lib/actions/results.test.js` to worry about (confirmed — no test file exists for that action set today). Manual: `npx next build` plus a dev-server boot check, consistent with tonight's other UI-adjacent tasks — this task does touch real logic (`submitExam`, `grade()`), so it keeps its existing automated coverage rather than dropping to build-check-only.
