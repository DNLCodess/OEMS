# Result Model Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Results become visible to students immediately on submission (no manual release gate), and essay/short-answer question types — along with the manual-grading pathway that only existed to support them — are removed from the app.

**Architecture:** `submitExam` starts setting `results.released_at` at insert time instead of leaving it `null`; the existing RLS policy needs no change since it already just checks `released_at IS NOT NULL`. Every consumer of "release could be delayed" (release/unrelease actions and UI, "not yet released" branches, unreleased-result dashboard metrics) and every consumer of "some questions need manual grading" (GradePanel, the grade-attempt route, `updateResponseGrade`/`recalculateResult`, the `needs_review` concept) is deleted, not hidden — both states can never occur again once this ships.

**Tech Stack:** Next.js 16 Server Actions, Supabase (Postgres/RLS), Vitest.

## Global Constraints

- No database migration. `results.released_at` and `question_type`'s `'essay'`/`'short_answer'` enum values stay in the schema, unused. (spec: Database / Non-goals)
- No new dependencies. CSV export (`ResultsTable.js`'s `exportCSV`) and `window.print()` are the PDF/Excel export mechanisms — untouched except dropping now-gone columns from CSV headers. (spec: Export)
- The demo `short_answer` question, its `exam_questions` link, and its `responses` row have already been deleted directly against the live Supabase project — not part of any task here.
- Where removing code leaves a file with no remaining exports, delete the file and fix its one import site — don't leave an empty file.

---

### Task 1: Results release immediately on submission

**Files:**
- Modify: `lib/actions/attempts.js:226-235`
- Test: `lib/actions/attempts.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `submitExam`'s result-row insert now always includes `released_at`. Later tasks (2, 4, 5, 6) rely on every `results` row having a non-null `released_at` from now on.

- [ ] **Step 1: Write the failing test**

Add to the existing `describe('submitExam', ...)` block in `lib/actions/attempts.test.js`, right after the `'proceeds normally for an exam-access-channel session (happy path preserved)'` test:

```javascript
  it('sets released_at immediately when inserting the result row', async () => {
    const supabase = createMockSupabaseClient({
      attempts: [
        { data: { id: 'attempt-1', exam_id: 'exam-1', status: 'in_progress', student_id: 'stu-1' }, error: null },
        { data: null, error: null }, // update → submitted
      ],
      exam_questions: [{
        data: [{ question_id: 'q1', marks: 10, question_bank: { type: 'mcq', correct_answer: 'a' } }],
        error: null,
      }],
      responses: [
        { data: [{ question_id: 'q1', student_answer: 'a' }], error: null },
        { data: null, error: null },
      ],
      exams:   [{ data: { pass_mark: 50 }, error: null }],
      results: [{ data: null, error: null }],
    })
    supabase.auth.getUser.mockResolvedValue(authUserWith('exam_access'))
    createClient.mockResolvedValue(supabase)

    await submitExam('attempt-1')

    const resultsBuilder = supabase.from.mock.results.find(
      (r, i) => supabase.from.mock.calls[i][0] === 'results'
    ).value
    const insertedRow = resultsBuilder.insert.mock.calls[0][0]
    expect(insertedRow.released_at).toEqual(expect.any(String))
    expect(new Date(insertedRow.released_at).toString()).not.toBe('Invalid Date')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/actions/attempts.test.js -t "sets released_at immediately"`
Expected: FAIL — `insertedRow.released_at` is `undefined`.

- [ ] **Step 3: Update `submitExam`**

In `lib/actions/attempts.js`, replace:

```javascript
  // Insert result row (released_at = null → not visible to student yet)
  const { error: resultError } = await supabase
    .from('results')
    .insert({
      attempt_id:  attemptId,
      student_id:  user.id,
      exam_id:     attempt.exam_id,
      final_score: totalScore,
      passed,
    })
```

with:

```javascript
  // Results are visible to the student immediately — every remaining
  // question type auto-grades on submission, so there's no "waiting on
  // manual grading" state left to protect against.
  const { error: resultError } = await supabase
    .from('results')
    .insert({
      attempt_id:  attemptId,
      student_id:  user.id,
      exam_id:     attempt.exam_id,
      final_score: totalScore,
      passed,
      released_at: new Date().toISOString(),
    })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/actions/attempts.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/attempts.js lib/actions/attempts.test.js
git commit -m "feat: release exam results immediately on submission"
```

---

### Task 2: Delete the release-gate and manual-grading actions; simplify ResultsTable

**Files:**
- Delete: `lib/actions/results.js`
- Modify: `components/lecturer/ResultsTable.js`

**Interfaces:**
- Consumes: Task 1's guarantee that every result has `released_at` set.
- Produces: `ResultsTable` no longer accepts an `allReleased` prop, and each row no longer needs a `released` or `grading_status` field — Task 4 (which computes the `rows` passed into it) must stop producing those.

- [ ] **Step 1: Delete `lib/actions/results.js`**

All four of its exports are dead: `releaseResults`/`unreleaseResults` because release is now automatic (Task 1), `updateResponseGrade`/`recalculateResult` because no question type is ever manually graded (essay/short-answer are being removed in Task 3/7 — nothing produces a `responses` row with `is_correct: null` anymore).

```bash
rm lib/actions/results.js
```

- [ ] **Step 2: Rewrite `components/lecturer/ResultsTable.js`**

Replace the full file content with:

```javascript
'use client'

import { Download, Printer, CheckCircle2, XCircle } from 'lucide-react'

export function ResultsTable({ rows, totalPossible }) {
  // ── CSV export ──────────────────────────────────────────────────────────────
  function exportCSV() {
    const headers = ['Rank', 'Full Name', 'Matric Number', 'Score', 'Total', 'Percentage', 'Pass/Fail']
    const csvRows = rows.map((r, i) => [
      i + 1,
      r.full_name,
      r.matric_number ?? '—',
      r.score ?? 0,
      totalPossible,
      r.percentage ?? 0,
      r.passed === true ? 'Pass' : r.passed === false ? 'Fail' : '—',
    ])
    const csv = [headers, ...csvRows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'results.csv' })
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Print ───────────────────────────────────────────────────────────────────
  function handlePrint() {
    window.print()
  }

  const passCount = rows.filter(r => r.passed === true).length
  const avgScore  = rows.length
    ? Math.round(rows.reduce((s, r) => s + (r.score ?? 0), 0) / rows.length)
    : 0

  return (
    <div>
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Submissions',  value: rows.length },
          { label: 'Pass rate',    value: rows.length ? `${Math.round((passCount / rows.length) * 100)}%` : '—' },
          { label: 'Average score', value: rows.length ? `${avgScore}/${totalPossible}` : '—' },
        ].map(s => (
          <div key={s.label} className="bg-surface border border-border rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-text-primary">{s.value}</p>
            <p className="text-xs text-text-muted mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-end gap-2 mb-4 print:hidden">
        <button
          onClick={exportCSV}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-slate-50 transition-colors"
        >
          <Download size={14} />
          Export CSV
        </button>
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-slate-50 transition-colors"
        >
          <Printer size={14} />
          Print
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-slate-50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">#</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">Student</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">Score</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">%</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-text-muted text-sm">
                  No submissions yet.
                </td>
              </tr>
            ) : rows.map((row, index) => (
              <tr key={row.attempt_id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 text-text-muted">{index + 1}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-text-primary">{row.full_name}</p>
                  {row.matric_number && (
                    <p className="font-mono text-xs text-text-muted">{row.matric_number}</p>
                  )}
                </td>
                <td className="px-4 py-3 font-medium tabular-nums">
                  {row.score ?? 0}/{totalPossible}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {row.percentage ?? 0}%
                </td>
                <td className="px-4 py-3">
                  {row.passed === true  && <span className="inline-flex items-center gap-1 text-success text-xs font-semibold"><CheckCircle2 size={13} />Pass</span>}
                  {row.passed === false && <span className="inline-flex items-center gap-1 text-danger  text-xs font-semibold"><XCircle     size={13} />Fail</span>}
                  {row.passed === null  && <span className="text-text-muted text-xs">Pending</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

This drops: the `releaseResults`/`unreleaseResults` import and both buttons, the `examId`/`examTitle`/`allReleased` props (no longer needed — nothing in this component calls a server action anymore), the `Status`/`Released`/`Actions` columns (status and released are always "done" now; actions had only the now-deleted grade-attempt-page link), and the CSV export's `Grading Status`/`Released` columns.

- [ ] **Step 3: Run the full suite to confirm nothing else broke yet**

Run: `npm test`
Expected: PASS (this task doesn't yet update the two callers of `ResultsTable` — that's Task 4 — so the app won't build cleanly until Task 4 lands; test suite has no build step, so it stays green).

- [ ] **Step 4: Commit**

```bash
git add lib/actions/results.js components/lecturer/ResultsTable.js
git commit -m "feat: remove release-gate and manual-grading server actions; simplify ResultsTable"
```

---

### Task 3: Delete the manual-grading pathway (GradePanel, grade-attempt route, grade() branch)

**Files:**
- Delete: `components/lecturer/GradePanel.js`
- Delete: `app/lecturer/exams/[id]/results/[attemptId]/page.js` (and the now-empty `[attemptId]` folder)
- Modify: `lib/actions/attempts.js:119-123`

**Interfaces:**
- Consumes: nothing from Task 2.
- Produces: nothing later tasks depend on — this is a pure deletion.

- [ ] **Step 1: Delete the files**

```bash
rm components/lecturer/GradePanel.js
rm -rf "app/lecturer/exams/[id]/results/[attemptId]"
```

- [ ] **Step 2: Remove the dead branch in `grade()`**

In `lib/actions/attempts.js`, replace:

```javascript
function grade(type, studentAnswer, correctAnswer, marks) {
  // essay / short_answer require manual grading
  if (type === 'essay' || type === 'short_answer') {
    return { is_correct: null, marks_awarded: 0 }
  }

  let isCorrect = false
```

with:

```javascript
function grade(type, studentAnswer, correctAnswer, marks) {
  let isCorrect = false
```

(Every remaining type — `mcq`, `multi_select`, `true_false`, `fill_blank` — is handled by the `if`/`else if` chain immediately below, unchanged.)

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A lib/actions/attempts.js components/lecturer/GradePanel.js "app/lecturer/exams/[id]/results/[attemptId]"
git commit -m "feat: remove manual-grading pathway (no question type needs it anymore)"
```

---

### Task 4: Update the lecturer results page

**Files:**
- Modify: `app/lecturer/exams/[id]/results/page.js`

**Interfaces:**
- Consumes: Task 2's new `ResultsTable` signature (`rows`, `totalPossible` only — no `examId`, `examTitle`, `allReleased`).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Remove the manual-grading query and fields**

In `app/lecturer/exams/[id]/results/page.js`, delete this block entirely (lines 47-54 in the current file):

```javascript
  const attemptIds = (attempts ?? []).map(a => a.id)
  const { data: manualCheck } = attemptIds.length
    ? await supabase
        .from('responses')
        .select('attempt_id')
        .in('attempt_id', attemptIds)
        .is('is_correct', null)
    : { data: [] }

```

Keep the `attemptIds` variable (it's still used by the per-question-difficulty query right below it) by adding it back as its own line where the block used to start:

```javascript
  const attemptIds = (attempts ?? []).map(a => a.id)

```

Then update the `results` query (drop `released_at` — no longer meaningful, every row has it) from:

```javascript
  const { data: results } = await supabase
    .from('results')
    .select('attempt_id, final_score, passed, released_at')
    .eq('exam_id', id)
```

to:

```javascript
  const { data: results } = await supabase
    .from('results')
    .select('attempt_id, final_score, passed')
    .eq('exam_id', id)
```

Delete this line (it references the now-removed `manualCheck`):

```javascript
  const attemptsNeedingReview = new Set((manualCheck ?? []).map(r => r.attempt_id))
```

Update the `rows` mapping from:

```javascript
  const rows = (attempts ?? []).map(a => {
    const result  = resultMap.get(a.id)
    const score   = result?.final_score ?? a.total_score ?? 0
    const pct     = totalPossible > 0 ? Math.round((score / totalPossible) * 100) : 0
    return {
      attempt_id:     a.id,
      full_name:      a.users?.full_name ?? 'Unknown',
      matric_number:  a.users?.matric_number ?? null,
      level:          a.users?.level ?? null,
      score,
      percentage:     pct,
      passed:         result?.passed ?? null,
      released:       !!result?.released_at,
      grading_status: attemptsNeedingReview.has(a.id) ? 'needs_review' : 'graded',
    }
  })

  const allReleased = rows.length > 0 && rows.every(r => r.released)
```

to:

```javascript
  const rows = (attempts ?? []).map(a => {
    const result  = resultMap.get(a.id)
    const score   = result?.final_score ?? a.total_score ?? 0
    const pct     = totalPossible > 0 ? Math.round((score / totalPossible) * 100) : 0
    return {
      attempt_id:    a.id,
      full_name:     a.users?.full_name ?? 'Unknown',
      matric_number: a.users?.matric_number ?? null,
      level:         a.users?.level ?? null,
      score,
      percentage:    pct,
      passed:        result?.passed ?? null,
    }
  })
```

- [ ] **Step 2: Update the `ResultsTable` call site**

Replace:

```javascript
              <ResultsTable
                examId={id}
                examTitle={exam.title}
                rows={rows}
                totalPossible={totalPossible}
                allReleased={allReleased}
              />
```

with:

```javascript
              <ResultsTable
                rows={rows}
                totalPossible={totalPossible}
              />
```

- [ ] **Step 2: Run `npx next build` to confirm the page compiles**

Run: `npx next build`
Expected: succeeds with no errors referencing this file.

- [ ] **Step 3: Commit**

```bash
git add "app/lecturer/exams/[id]/results/page.js"
git commit -m "feat: drop manual-grading and release-status fields from lecturer results page"
```

---

### Task 5: Update student-facing pages (release gate removal)

**Files:**
- Modify: `app/student/exams/[id]/result/page.js`
- Modify: `app/student/exams/page.js`
- Modify: `app/student/results/page.js`
- Modify: `app/student/dashboard/page.js`

**Interfaces:**
- Consumes: Task 1's guarantee that every submitted attempt has a result with `released_at` set.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: `app/student/exams/[id]/result/page.js`**

Remove the now-impossible "not released" branch. Replace:

```javascript
  // Fetch released result (null if not yet released)
  const { data: result } = await supabase
    .from('results')
    .select('final_score, passed, released_at')
    .eq('exam_id', examId)
    .eq('student_id', user.id)
    .not('released_at', 'is', null)
    .maybeSingle()
```

with:

```javascript
  // A submitted attempt always has a result row by now (set at submission).
  const { data: result } = await supabase
    .from('results')
    .select('final_score, passed')
    .eq('exam_id', examId)
    .eq('student_id', user.id)
    .maybeSingle()
```

Delete this entire block:

```javascript
  // ── Submitted but result not released ──────────────────────────────────────
  if (!result) {
    return (
      <div className="max-w-lg mx-auto px-6 py-16 text-center">
        <div className="w-16 h-16 bg-primary-light rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={28} className="text-primary" />
        </div>
        <h1 className="text-xl font-bold text-text-primary mb-2">Exam submitted!</h1>
        <p className="text-sm text-text-secondary mb-1">
          Your answers have been received and are being reviewed.
        </p>
        <p className="text-sm text-text-muted">
          Results will appear here once your lecturer releases them.
        </p>
        <Link href="/student/exams" className="inline-block mt-6 text-primary text-sm hover:underline">
          ← Back to my exams
        </Link>
      </div>
    )
  }

```

Since every remaining question type auto-grades, `manualResponses` can never have entries. Delete the block that renders it:

```javascript
      {manualResponses.length > 0 && (
        <div className="mt-6 p-4 bg-surface border border-border rounded-xl">
          <p className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">{manualResponses.length} question(s)</span>{' '}
            (short answer / essay) will be graded manually by your lecturer.
            Your score above reflects auto-graded questions only.
          </p>
        </div>
      )}
```

And simplify the two lines above it from:

```javascript
  const autoGradedResponses  = responses.filter(r => r.is_correct !== null)
  const manualResponses      = responses.filter(r => r.is_correct === null)
```

to:

```javascript
  const autoGradedResponses = responses
```

(`responses` already only contains this attempt's rows, and every row now has a non-null `is_correct`.)

- [ ] **Step 2: `app/student/exams/page.js`**

Drop the release filter. Replace:

```javascript
  // Fetch released results
  const { data: results } = examIds.length
    ? await supabase
        .from('results')
        .select('exam_id, final_score, passed, released_at')
        .eq('student_id', user.id)
        .in('exam_id', examIds)
        .not('released_at', 'is', null)
    : { data: [] }
```

with:

```javascript
  const { data: results } = examIds.length
    ? await supabase
        .from('results')
        .select('exam_id, final_score, passed')
        .eq('student_id', user.id)
        .in('exam_id', examIds)
    : { data: [] }
```

- [ ] **Step 3: `app/student/results/page.js`**

Replace:

```javascript
  const { data: results } = await supabase
    .from('results')
    .select(`
      final_score, passed, released_at,
      exams:exam_id (
        id, title, pass_mark, exam_type,
        courses!course_id ( course_code, course_title ),
        exam_questions ( marks )
      ),
      attempts:attempt_id ( submitted_at )
    `)
    .eq('student_id', user.id)
    .not('released_at', 'is', null)
    .order('released_at', { ascending: false })
```

with:

```javascript
  const { data: results } = await supabase
    .from('results')
    .select(`
      final_score, passed,
      exams:exam_id (
        id, title, pass_mark, exam_type,
        courses!course_id ( course_code, course_title ),
        exam_questions ( marks )
      ),
      attempts:attempt_id ( submitted_at )
    `)
    .eq('student_id', user.id)
    .order('attempts(submitted_at)', { ascending: false })
```

Update the empty-state and summary copy — replace:

```javascript
          description="Your results will appear here once your lecturer releases them."
```

with:

```javascript
          description="Your results will appear here as soon as you complete an exam."
```

and replace:

```javascript
          {total} result{total !== 1 ? 's' : ''} released
```

with:

```javascript
          {total} result{total !== 1 ? 's' : ''}
```

- [ ] **Step 4: `app/student/dashboard/page.js`**

Replace:

```javascript
    // All released results with course and marks data
    supabase
      .from('results')
      .select(`
        final_score, passed, released_at,
        exams:exam_id (
          id, title, pass_mark,
          courses!course_id ( course_code, course_title ),
          exam_questions ( marks )
        )
      `)
      .eq('student_id', user.id)
      .not('released_at', 'is', null)
      .order('released_at', { ascending: false }),
```

with:

```javascript
    // All results with course and marks data
    supabase
      .from('results')
      .select(`
        final_score, passed,
        exams:exam_id (
          id, title, pass_mark,
          courses!course_id ( course_code, course_title ),
          exam_questions ( marks )
        )
      `)
      .eq('student_id', user.id)
      .order('created_at', { ascending: false }),
```

Replace the stat label:

```javascript
              sub="across all released results"
```

with:

```javascript
              sub="across all completed exams"
```

- [ ] **Step 5: Run `npx next build`**

Run: `npx next build`
Expected: succeeds with no errors referencing these four files.

- [ ] **Step 6: Commit**

```bash
git add "app/student/exams/[id]/result/page.js" app/student/exams/page.js app/student/results/page.js app/student/dashboard/page.js
git commit -m "feat: remove release-gate handling from student-facing pages"
```

---

### Task 6: Update admin/super-admin/lecturer dashboards

**Files:**
- Modify: `app/admin/dashboard/page.js`
- Modify: `app/super-admin/dashboard/page.js`
- Modify: `app/lecturer/dashboard/page.js`

**Interfaces:**
- Consumes: Task 1's guarantee.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: `app/admin/dashboard/page.js`**

Remove the dead filter. Replace:

```javascript
    supabase.from('results')
      .select('passed, exam_id')
      .not('released_at', 'is', null)
```

with:

```javascript
    supabase.from('results')
      .select('passed, exam_id')
```

Replace:

```javascript
        .select('passed, released_at')
```

with:

```javascript
        .select('passed')
```

Replace the now-meaningless `releasedResults` metric (every result is released, so this line duplicates `totalResults`) — delete:

```javascript
  const releasedResults = (uniResults ?? []).filter(r => r.released_at).length
```

and check the JSX for any usage of `releasedResults` (search the file); if a `<StatBox>`/similar shows "Results released", remove that whole stat tile — it can only ever equal total results now and adds no information.

- [ ] **Step 2: `app/super-admin/dashboard/page.js`**

Replace:

```javascript
    supabase.from('results')
      .select('passed, exam_id')
      .not('released_at', 'is', null)
      .limit(5000),
```

with:

```javascript
    supabase.from('results')
      .select('passed, exam_id')
      .limit(5000),
```

- [ ] **Step 3: `app/lecturer/dashboard/page.js`**

Remove the "needs manual review" query entirely — delete this block:

```javascript
    // Attempts needing manual review
    supabase
      .from('attempts')
      .select('id, exam_id, status, submitted_at, users:student_id ( full_name, matric_number )')
      .in('status', ['submitted'])
      .order('submitted_at', { ascending: true }),
```

and its destructured variable from the `Promise.all` array (check the array's destructuring line near the top of the function and remove the corresponding positional variable — read the current file to get the exact variable name before editing, since removing an array-destructured entry shifts every variable after it).

Delete the separate "Manual grading check" query block:

```javascript
  // Manual grading check: responses with is_correct = null in lecturer's exams
  const { data: needsReview } = myExamIds.length
    ? await supabase
        .from('responses')
        .select('attempt_id, attempts!inner ( exam_id, student_id, users:student_id ( full_name, matric_number ) )')
```

(read the full block in the current file — it continues past what's shown here — and delete it in its entirety, along with any variable derived from `needsReview` later in the file).

Simplify the results query — replace both occurrences of:

```javascript
      .select('exam_id, final_score, passed, released_at, student_id')
```

with:

```javascript
      .select('exam_id, final_score, passed, student_id')
```

In the stats-building loop, replace:

```javascript
  const examStatsMap = {}
  for (const r of resultsData ?? []) {
    if (!examStatsMap[r.exam_id]) examStatsMap[r.exam_id] = { total: 0, passed: 0, sumScore: 0, unreleased: 0 }
    examStatsMap[r.exam_id].total++
    if (r.passed)       examStatsMap[r.exam_id].passed++
    examStatsMap[r.exam_id].sumScore += r.final_score ?? 0
    if (!r.released_at) examStatsMap[r.exam_id].unreleased++
  }
```

with:

```javascript
  const examStatsMap = {}
  for (const r of resultsData ?? []) {
    if (!examStatsMap[r.exam_id]) examStatsMap[r.exam_id] = { total: 0, passed: 0, sumScore: 0 }
    examStatsMap[r.exam_id].total++
    if (r.passed) examStatsMap[r.exam_id].passed++
    examStatsMap[r.exam_id].sumScore += r.final_score ?? 0
  }
```

Delete the now-dead "unreleased results" block:

```javascript
  // Unreleased results that need attention
  const examsWithUnreleasedResults = (myExams ?? []).filter(e => {
    const s = examStatsMap[e.id]
    return s && s.unreleased > 0 && e.status === 'closed'
  })
```

And every place `examStatsMap[e.id] ?? { total: 0, passed: 0, sumScore: 0, unreleased: 0 }` appears as a fallback, drop the trailing `, unreleased: 0` to match the new shape.

Delete the JSX block that renders the "closed exams with unreleased results" banner (search for `examsWithUnreleasedResults.length` — delete the whole containing `<div>`/`<Link>` alert block, including its "Release →" link).

Replace the health-row line:

```javascript
                <HealthRow label="Awaiting release"     value={(resultsData ?? []).filter(r => !r.released_at).length} max={null} />
```

by deleting it entirely (delete the whole `<HealthRow ... />` line — there's nothing left to report).

- [ ] **Step 2: Run `npx next build`**

Run: `npx next build`
Expected: succeeds with no errors referencing these three files. Pay particular attention to the lecturer dashboard — if the build reports an unused-variable or undefined-reference error, it means a `needsReview`/`examsWithUnreleasedResults`-derived reference was missed; grep the file for both names and remove any remainder.

- [ ] **Step 3: Commit**

```bash
git add app/admin/dashboard/page.js app/super-admin/dashboard/page.js app/lecturer/dashboard/page.js
git commit -m "feat: remove unreleased-results and needs-review metrics from dashboards"
```

---

### Task 7: Remove essay and short-answer question types

**Files:**
- Modify: `lib/validations/questions.js:3`
- Modify: `components/questions/TypeSelector.js`
- Modify: `components/questions/QuestionForm.js:127-128,313-331`
- Modify: `components/questions/QuestionPreview.js:6-12,88-99`
- Modify: `components/exams/QuestionPickerModal.js:18-19`
- Modify: `lib/utils.js:19-20`
- Modify: `lib/actions/questions.js:17`

**Interfaces:**
- Consumes: nothing from earlier tasks — fully independent, could have run first.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: `lib/validations/questions.js`**

Replace:

```javascript
const QUESTION_TYPES = ['mcq', 'multi_select', 'true_false', 'fill_blank', 'short_answer', 'essay']
```

with:

```javascript
const QUESTION_TYPES = ['mcq', 'multi_select', 'true_false', 'fill_blank']
```

- [ ] **Step 2: `components/questions/TypeSelector.js`**

Remove the `MessageSquare` and `FileText` icon imports (no longer used) — replace:

```javascript
import {
  CheckSquare,
  ToggleLeft,
  List,
  PenLine,
  MessageSquare,
  FileText,
} from 'lucide-react'
```

with:

```javascript
import {
  CheckSquare,
  ToggleLeft,
  List,
  PenLine,
} from 'lucide-react'
```

Delete the two trailing entries from the `TYPES` array:

```javascript
  {
    value: 'short_answer',
    label: 'Short Answer',
    description: 'Brief written response',
    icon: MessageSquare,
  },
  {
    value: 'essay',
    label: 'Essay',
    description: 'Extended response',
    icon: FileText,
  },
```

(delete these two object literals; `fill_blank` remains the last entry in the array, with its trailing comma kept as-is).

- [ ] **Step 3: `components/questions/QuestionForm.js`**

Delete these two lines:

```javascript
  const showShortAnswer   = watchedType === 'short_answer'
  const showEssayNote     = watchedType === 'essay'
```

Delete these two JSX blocks:

```javascript
            {showShortAnswer && (
              <Input
                id="correct_answer_short"
                label="Model answer (for your reference)"
                placeholder="Enter a sample correct response…"
                hint="Shown to you when manually grading. Students write freely."
                error={errors.correct_answer?.message}
                {...register('correct_answer')}
              />
            )}

            {showEssayNote && (
              <div className="rounded-xl border border-border bg-page px-5 py-4">
                <p className="text-sm font-medium text-text-primary mb-1">Manual grading</p>
                <p className="text-sm text-text-secondary leading-relaxed">
                  Essay questions are graded manually. You&apos;ll see each student&apos;s submission in the results panel and can award marks and write feedback there.
                </p>
              </div>
            )}
```

- [ ] **Step 4: `components/questions/QuestionPreview.js`**

Replace:

```javascript
const TYPE_LABELS = {
  mcq:          'Multiple Choice — select one',
  multi_select: 'Multiple Choice — select all that apply',
  true_false:   'True or False',
  fill_blank:   'Fill in the blank',
  short_answer: 'Short Answer',
  essay:        'Essay',
}
```

with:

```javascript
const TYPE_LABELS = {
  mcq:          'Multiple Choice — select one',
  multi_select: 'Multiple Choice — select all that apply',
  true_false:   'True or False',
  fill_blank:   'Fill in the blank',
}
```

Delete these two JSX blocks:

```javascript
          {type === 'short_answer' && (
            <div className="border border-border rounded-lg px-4 py-8 bg-page text-center">
              <p className="text-sm text-text-muted">Student writes a short response here…</p>
            </div>
          )}

          {type === 'essay' && (
            <div className="border border-border rounded-lg px-4 py-12 bg-page text-center">
              <p className="text-sm text-text-muted">Student writes an extended essay response here…</p>
            </div>
          )}
```

- [ ] **Step 5: `components/exams/QuestionPickerModal.js`**

Delete these two lines from its type-label map:

```javascript
  short_answer: 'Short answer',
  essay:        'Essay',
```

- [ ] **Step 6: `lib/utils.js`**

Replace:

```javascript
export const QUESTION_TYPE_LABELS = {
  mcq:          'MCQ',
  multi_select: 'Multi-select',
  true_false:   'True / False',
  fill_blank:   'Fill-in-blank',
  short_answer: 'Short answer',
  essay:        'Essay',
}
```

with:

```javascript
export const QUESTION_TYPE_LABELS = {
  mcq:          'MCQ',
  multi_select: 'Multi-select',
  true_false:   'True / False',
  fill_blank:   'Fill-in-blank',
}
```

- [ ] **Step 7: `lib/actions/questions.js`**

`type` can never be `'essay'` again, so the special case is dead. Replace:

```javascript
    correct_answer: ['essay'].includes(data.type) ? null : (data.correct_answer ?? null),
```

with:

```javascript
    correct_answer: data.correct_answer ?? null,
```

- [ ] **Step 8: Run `npx next build` and the full test suite**

Run: `npx next build && npm test`
Expected: both succeed. If the build reports an unused-import error in `TypeSelector.js` or elsewhere, it means an icon import wasn't fully removed — check Step 2 was applied exactly.

- [ ] **Step 9: Commit**

```bash
git add lib/validations/questions.js components/questions/TypeSelector.js components/questions/QuestionForm.js components/questions/QuestionPreview.js components/exams/QuestionPickerModal.js lib/utils.js lib/actions/questions.js
git commit -m "feat: remove essay and short-answer question types"
```

---

### Task 8: Keep the dev seed data consistent with the removed types and grading states

**Files:**
- Modify: `lib/actions/dev.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks depend on.

Not in the original spec's file list, but found during self-review: `seedDemoData()` (dev-only, gated by `devOnly()`) still creates a `type: 'short_answer'` question and a `responses` row with `is_correct: null` — exactly the pattern just deleted from the live project's demo data in this session. Left as-is, re-running the seeder recreates the inconsistency. This task only fixes that; it does not touch the fact that `seedDemoData()` still creates the student account via email+password (`upsertUser('student@dun.edu.ng', 'Demo1234!', ...)`), which predates and is inconsistent with this session's earlier credential-less student auth redesign — that's a separate, larger fix, out of scope here, and should be flagged as its own follow-up.

- [ ] **Step 1: Drop the short-answer seed question**

In `lib/actions/dev.js`, delete this object from the `question_bank` upsert array (the sixth and last entry):

```javascript
      {
        university_id: uniId, created_by: lecturerId, course_id: csc301Id,
        type: 'short_answer', difficulty: 'hard', tags: ['complexity'],
        body: '<p>Explain the difference between best-case, average-case, and worst-case time complexity. Give an example using Linear Search.</p>',
        options: null,
        correct_answer: null,
        explanation: null,
      },
```

(remove the trailing comma left on the fifth entry's closing `},` if your editor doesn't do this automatically — the array must remain valid JS with the `fill_blank` entry now last.)

- [ ] **Step 2: Update the exam-questions marks comment and mapping**

Replace:

```javascript
  const examQRows = questions.map((q, i) => ({
    exam_id: examId, question_id: q.id,
    order_index: i,
    marks: i < 4 ? 2 : (i === 4 ? 3 : 5), // Q1-4: 2 marks, Q5: 3 marks, Q6: 5 marks
  }))
```

with:

```javascript
  const examQRows = questions.map((q, i) => ({
    exam_id: examId, question_id: q.id,
    order_index: i,
    marks: i < 4 ? 2 : 3, // Q1-4: 2 marks, Q5: 3 marks
  }))
```

- [ ] **Step 3: Drop the manually-graded response row and the now-inflated total_score**

Delete the sixth response row (references the now-deleted sixth question):

```javascript
    { attempt_id: attemptId, question_id: questions[5].id, student_answer: '"Best case is O(1) when the target is the first element. Worst case is O(n) when the target is last or absent. Average case is O(n/2) ≈ O(n)."', is_correct: null, marks_awarded: 2, teacher_feedback: 'Good explanation. Remember to mention that average case assumes uniform distribution.' },
```

Update the attempt's seeded score and status — replace:

```javascript
      status: 'graded',
      total_score: 11,
```

with:

```javascript
      status: 'submitted',
      total_score: 9,
```

(11 was 2+2+0+2+3+2 across six questions; with the sixth removed it's 2+2+0+2+3 = 9. `'graded'` is no longer a status the app ever sets — `'submitted'` is correct for a completed attempt now.)

Update the final result upsert's score to match — replace:

```javascript
  await admin.from('results').upsert({
    attempt_id: attemptId,
    student_id: studentId,
    exam_id: examId,
    final_score: 11,
    passed: true,
    released_at: new Date().toISOString(),
  }, { onConflict: 'attempt_id' })
```

with:

```javascript
  await admin.from('results').upsert({
    attempt_id: attemptId,
    student_id: studentId,
    exam_id: examId,
    final_score: 9,
    passed: true,
    released_at: new Date().toISOString(),
  }, { onConflict: 'attempt_id' })
```

(`released_at` was already being set here — this seeder already matched the new "always released" behavior for its one seeded result, nothing to change on that line.)

- [ ] **Step 4: Run `npx next build`**

Run: `npx next build`
Expected: succeeds — this file isn't type-checked beyond normal JS parsing, so the build mainly confirms no syntax error was introduced.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/dev.js
git commit -m "fix: keep dev seed data consistent with removed question types and grading states"
```
