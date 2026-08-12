# Lecturer Portal Loading/Error State Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every page under `app/lecturer/**` a layout-matching loading skeleton, a shared last-resort error boundary, and consistent inline "failed to load" banners on Supabase query errors — replacing the current mix of blank-page loads and silently-zeroed stats.

**Architecture:** Two new shared `components/ui/` primitives (`Skeleton`, `QueryErrorBanner`) get composed into one `loading.js` per lecturer route (Next.js's file convention auto-wraps the sibling `page.js` in `<Suspense>`, no manual wiring) and into each page's existing Supabase query error-checks. One shared `app/lecturer/error.js` client-component boundary catches anything that still throws.

**Tech Stack:** Next.js App Router (loading.js/error.js file conventions), React Server Components, Supabase JS client, Tailwind CSS, lucide-react icons.

## Global Constraints

- No new npm dependencies.
- No changes to mutation pending/error handling in client components (`WorkflowPanel`, `ExamAccessPanel`, `ArchiveButton`, `ExamBuilder`, `AccessCodePanel`, `QuestionPickerModal`, `QuestionForm`, `ExamSettingsForm`) — already consistent, out of scope.
- No changes to admin, super-admin, or student routes — lecturer portal (`app/lecturer/**`) only.
- No error-tracking/Sentry integration — `console.error` only, matching the existing `console.error('[QuestionsPage]', error)` convention in `app/lecturer/questions/page.js:42`.
- Every query-error banner uses the shared `QueryErrorBanner` component (Task 2) — no ad-hoc inline `<div className="bg-danger-light ...">` blocks.
- `error.js` is a last-resort boundary for unhandled exceptions only — it must NOT be reached by a normal `{ data, error }` Supabase response; those are always handled in-page with `QueryErrorBanner`.
- No automated tests for this work — this repo has no React rendering test setup (`vitest.config.js` runs in `environment: 'node'`, no `@testing-library/react`), and no `app/**/page.js` file has ever had a test. Every task ends with a manual dev-server verification step instead, consistent with existing convention.

---

### Task 1: `Skeleton` primitive

**Files:**
- Create: `components/ui/Skeleton.js`

**Interfaces:**
- Produces: `Skeleton({ className })` — a JSX component. `className` is appended after the base pulse styling, so callers pass sizing/spacing utility classes (e.g. `"h-4 w-32"`).

- [ ] **Step 1: Create the component**

```js
export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-slate-100 rounded ${className}`} />
}
```

- [ ] **Step 2: Manual verification**

Run: `npm run lint`
Expected: no errors on the new file (unused-var/import rules only — there's nothing to exercise yet since nothing imports it).

- [ ] **Step 3: Commit**

```bash
git add components/ui/Skeleton.js
git commit -m "feat: add Skeleton loading-placeholder primitive"
```

---

### Task 2: `QueryErrorBanner` primitive

**Files:**
- Create: `components/ui/QueryErrorBanner.js`
- Modify: `app/lecturer/questions/page.js:63-67` (replace the existing inline banner div with the new shared component — this is the one page that already has this pattern; switching it over keeps it as the single source of truth for the banner's markup)

**Interfaces:**
- Produces: `QueryErrorBanner({ message })` — a JSX component. `message` is required, no default (every call site must state what failed).

- [ ] **Step 1: Create the component**

```js
export function QueryErrorBanner({ message }) {
  return (
    <div className="bg-danger-light border border-danger/20 rounded-xl px-5 py-4 text-sm text-danger">
      {message}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `questions/page.js`**

In `app/lecturer/questions/page.js`, add the import alongside the other component imports (near line 7):

```js
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
```

Replace the existing inline banner block (currently lines 63-67):

```js
        {error && (
          <div className="bg-danger-light border border-danger/20 rounded-xl px-5 py-4 text-sm text-danger">
            Failed to load questions. Please refresh.
          </div>
        )}
```

with:

```js
        {error && <QueryErrorBanner message="Failed to load questions. Please refresh." />}
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, log in as a lecturer, visit `/lecturer/questions`. Page should render exactly as before (question cards, filters) — this step only changed how the (currently unreachable, since the query isn't broken) banner is rendered, not its trigger condition. Then temporarily force the failure to confirm the banner itself still renders correctly: in `app/lecturer/questions/page.js`, change the query at line 30 from

```js
    .select('id, body, type, difficulty, tags, created_at, is_archived, course_id, courses!course_id(course_code, course_title)')
```

to

```js
    .select('nonexistent_column_xyz')
```

Reload `/lecturer/questions` — the red "Failed to load questions. Please refresh." banner should appear in place of the question grid. Revert the `.select(...)` line back to its original value before continuing.

- [ ] **Step 4: Commit**

```bash
git add components/ui/QueryErrorBanner.js app/lecturer/questions/page.js
git commit -m "feat: add shared QueryErrorBanner and wire into questions page"
```

---

### Task 3: Shared `error.js` boundary

**Files:**
- Create: `app/lecturer/error.js`

**Interfaces:**
- Consumes: Next.js passes `{ error, reset }` automatically to any `error.js` default export — `error` is the thrown `Error` object, `reset()` re-renders the nearest segment without a full navigation.
- Produces: nothing consumed elsewhere — this is a terminal boundary.

- [ ] **Step 1: Create the boundary**

```js
'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

export default function LecturerError({ error, reset }) {
  useEffect(() => {
    console.error('[LecturerPortal]', error)
  }, [error])

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-danger-light mb-4">
          <AlertTriangle className="size-7 text-danger" />
        </span>
        <h1 className="text-base font-semibold text-text-primary mb-1">Something went wrong</h1>
        <p className="text-sm text-text-secondary mb-6">
          An unexpected error occurred while loading this page.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => reset()}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors"
          >
            Try again
          </button>
          <Link
            href="/lecturer/dashboard"
            className="px-4 py-2 border border-border text-text-primary text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
```

This renders inside `app/lecturer/layout.js:10`'s `<div className="flex flex-col flex-1 min-w-0 overflow-y-auto ...">` wrapper (in place of `{children}`), so `flex-1 items-center justify-center` centers it in the available content area next to the sidebar.

- [ ] **Step 2: Manual verification**

Run: `npm run dev`, log in as a lecturer. Temporarily add `throw new Error('test boundary')` as the first line inside `LecturerDashboardPage` in `app/lecturer/dashboard/page.js` (right after the function's opening brace, before `const user = ...`). Visit `/lecturer/dashboard` — the branded "Something went wrong" card should appear (sidebar still visible), with working "Try again" and "Back to dashboard" (link stays on the same broken page since the throw is unconditional, which is expected). Remove the `throw` line before continuing.

- [ ] **Step 3: Commit**

```bash
git add app/lecturer/error.js
git commit -m "feat: add shared error boundary for lecturer portal"
```

---

### Task 4: Dashboard — loading skeleton + query error handling

**Files:**
- Create: `app/lecturer/dashboard/loading.js`
- Modify: `app/lecturer/dashboard/page.js`

**Interfaces:**
- Consumes: `Skeleton` (Task 1), `QueryErrorBanner` (Task 2).

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function DashboardLoading() {
  return (
    <div className="h-full flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-9 w-32" />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface border border-border rounded-xl p-5 flex items-center gap-4">
              <Skeleton className="size-10 shrink-0" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-6 w-12" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-surface border border-border rounded-xl p-5">
              <Skeleton className="h-4 w-28 mb-4" />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            </div>
            <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
              <Skeleton className="h-4 w-36 mb-2" />
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          </div>

          <div className="space-y-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-5 space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Check errors on the dashboard's queries**

In `app/lecturer/dashboard/page.js`, the three `Promise.all` queries (lines 19-44) and the follow-up `resultsData` query (lines 48-53) currently discard `error`. Change the destructuring to capture it:

```js
  const [
    { count: questionCount, error: questionsError },
    { data: myExams, error: examsError },
    { data: allResults },
  ] = await Promise.all([
```

(`allResults` stays as-is — it's the unused placeholder query already being replaced below, per the existing comment on line 43.)

```js
  const myExamIds = (myExams ?? []).map(e => e.id)
  const { data: resultsData, error: resultsError } = myExamIds.length
    ? await supabase
        .from('results')
        .select('exam_id, final_score, passed, student_id')
        .in('exam_id', myExamIds)
    : { data: [] }
```

- [ ] **Step 3: Import `QueryErrorBanner` and render it**

Add the import near the top (alongside the other component imports, after line 9):

```js
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
```

Wrap the existing `<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">...</div>` block (lines 122-251, everything below the 4 stat cards) in a conditional. Replace the opening of that block:

```js
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
```

with:

```js
        {(examsError || resultsError || questionsError) ? (
          <QueryErrorBanner message="Failed to load dashboard data. Please refresh." />
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
```

Then find that block's existing closing tag (currently line 251):

```js
        </div>
      </main>
```

and add the matching closing `)}` between them:

```js
        </div>
        )}
      </main>
```

The 4 stat cards above this block keep using their existing `?? 0`/`(myExams ?? []).length` fallbacks unguarded — on error they'll show `0`, but the banner directly below makes clear the load failed, so the zeroes aren't mistaken for real data. This mirrors the existing precedent in `questions/page.js`, where the `TopBar` subtitle (`questions?.length`) is likewise not specially guarded in the error path.

- [ ] **Step 4: Manual verification — loading skeleton**

Run: `npm run dev`. Temporarily add `await new Promise(r => setTimeout(r, 2000))` as the first line inside `LecturerDashboardPage` (after the function's opening brace). Visit `/lecturer/dashboard` — the skeleton should render for ~2 seconds before the real dashboard pops in, with no layout jump. Remove the `setTimeout` line.

- [ ] **Step 5: Manual verification — error banner**

Temporarily change the `myExams` query's `.select(...)` (in the `Promise.all`) from

```js
      .select('id, title, status, pass_mark, courses!course_id ( course_code ), exam_questions ( marks )')
```

to

```js
      .select('nonexistent_column_xyz')
```

Reload `/lecturer/dashboard` — the stat cards should still show (with `0`s), and the banner "Failed to load dashboard data. Please refresh." should appear in place of the pipeline/performance/health panels. Revert the `.select(...)` line.

- [ ] **Step 6: Commit**

```bash
git add app/lecturer/dashboard/loading.js app/lecturer/dashboard/page.js
git commit -m "feat: add dashboard loading skeleton and query error handling"
```

---

### Task 5: Exams list — loading skeleton + query error handling

**Files:**
- Create: `app/lecturer/exams/loading.js`
- Modify: `app/lecturer/exams/page.js`

**Interfaces:**
- Consumes: `Skeleton` (Task 1), `QueryErrorBanner` (Task 2).

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function ExamsLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div className="space-y-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-10 w-28" />
      </div>

      <div className="flex items-center gap-4 mb-6 border-b border-border pb-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-14" />
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-surface border border-border rounded-xl p-5 space-y-3">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Check the query's error and render the banner**

In `app/lecturer/exams/page.js`, add the import near the top:

```js
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
```

Change line 38 from:

```js
  const { data: exams } = await query
```

to:

```js
  const { data: exams, error } = await query
  if (error) console.error('[ExamsPage]', error)
```

Replace the content ternary (currently lines 85-108):

```js
      {enriched.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={status ? `No ${status} exams` : 'No exams yet'}
          description={
            status
              ? 'Try a different status filter.'
              : 'Create your first exam to get started.'
          }
          action={
            !status && (
              <Link href="/lecturer/exams/new">
                <Button>Create your first exam</Button>
              </Link>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {enriched.map(exam => (
            <ExamCard key={exam.id} exam={exam} />
          ))}
        </div>
      )}
```

with:

```js
      {error ? (
        <QueryErrorBanner message="Failed to load exams. Please refresh." />
      ) : enriched.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={status ? `No ${status} exams` : 'No exams yet'}
          description={
            status
              ? 'Try a different status filter.'
              : 'Create your first exam to get started.'
          }
          action={
            !status && (
              <Link href="/lecturer/exams/new">
                <Button>Create your first exam</Button>
              </Link>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {enriched.map(exam => (
            <ExamCard key={exam.id} exam={exam} />
          ))}
        </div>
      )}
```

- [ ] **Step 3: Manual verification — loading skeleton**

Run: `npm run dev`. Temporarily add `await new Promise(r => setTimeout(r, 2000))` as the first line inside `ExamsPage` (after the opening brace). Visit `/lecturer/exams` — skeleton renders for ~2s, then the header/tabs/grid pop in without layout shift. Remove the `setTimeout` line.

- [ ] **Step 4: Manual verification — error banner**

Temporarily change the query's `.select(...)` template literal (lines 26-31) to `.select('nonexistent_column_xyz')`. Reload `/lecturer/exams` — the banner should replace the exam grid, with the header and status tabs still visible above it. Revert the `.select(...)`.

- [ ] **Step 5: Commit**

```bash
git add app/lecturer/exams/loading.js app/lecturer/exams/page.js
git commit -m "feat: add exams list loading skeleton and query error handling"
```

---

### Task 6: Exam detail — loading skeleton + query error handling

**Files:**
- Create: `app/lecturer/exams/[id]/loading.js`
- Modify: `app/lecturer/exams/[id]/page.js`

**Interfaces:**
- Consumes: `Skeleton` (Task 1), `QueryErrorBanner` (Task 2).

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function ExamDetailLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <Skeleton className="h-4 w-16 mb-2" />

      <div className="flex items-start justify-between gap-4 mt-2 mb-8">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="flex gap-2 shrink-0">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Skeleton className="h-4 w-24" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>

        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-surface border border-border rounded-xl p-5 space-y-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Split the `exam` query's error from "not found", check secondary query errors**

In `app/lecturer/exams/[id]/page.js`, add the import near the top:

```js
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
```

Change the `Promise.all` destructuring (currently line 22) from:

```js
  const [{ data: exam }, { data: examQuestions }, { data: bankQuestions }, { data: examAccess }] = await Promise.all([
```

to:

```js
  const [
    { data: exam, error: examError },
    { data: examQuestions, error: examQuestionsError },
    { data: bankQuestions, error: bankQuestionsError },
    { data: examAccess, error: examAccessError },
  ] = await Promise.all([
```

Replace the existing not-found check (currently line 61):

```js
  if (!exam || exam.created_by !== user.id) notFound()
```

with:

```js
  if (examError) {
    console.error('[ExamDetailPage]', examError)
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <Link href="/lecturer/exams" className="text-sm text-text-muted hover:text-primary transition-colors">
          ← Exams
        </Link>
        <div className="mt-4">
          <QueryErrorBanner message="Failed to load this exam. Please refresh." />
        </div>
      </div>
    )
  }

  if (!exam || exam.created_by !== user.id) notFound()

  const secondaryError = examQuestionsError || bankQuestionsError || examAccessError
  if (secondaryError) console.error('[ExamDetailPage]', secondaryError)
```

- [ ] **Step 3: Render the secondary-error banner above the question builder**

Replace the "Questions" heading block (currently lines 127-134):

```js
        <div className="lg:col-span-2">
          <h2 className="text-base font-semibold text-text-primary mb-4">Questions</h2>
          <ExamBuilder
            examId={id}
            initialQuestions={examQuestions ?? []}
            bankQuestions={bankQuestions ?? []}
            readOnly={!isEditable}
          />
        </div>
```

with:

```js
        <div className="lg:col-span-2">
          <h2 className="text-base font-semibold text-text-primary mb-4">Questions</h2>
          {secondaryError && (
            <div className="mb-4">
              <QueryErrorBanner message="Some exam data failed to load. Please refresh." />
            </div>
          )}
          <ExamBuilder
            examId={id}
            initialQuestions={examQuestions ?? []}
            bankQuestions={bankQuestions ?? []}
            readOnly={!isEditable}
          />
        </div>
```

- [ ] **Step 4: Manual verification — loading skeleton**

Run: `npm run dev`. Temporarily add `await new Promise(r => setTimeout(r, 2000))` as the first line inside `ExamDetailPage` (after the opening brace, before `const user = ...`). Visit `/lecturer/exams/<any real exam id>` — skeleton renders for ~2s before the real page. Remove the `setTimeout` line.

- [ ] **Step 5: Manual verification — primary error banner**

Temporarily change the `exam` query's `.select(...)` template literal to `.select('nonexistent_column_xyz')`. Reload the same exam URL — should show "← Exams" link plus the "Failed to load this exam" banner, no crash. Revert the `.select(...)`.

- [ ] **Step 6: Manual verification — secondary error banner**

Temporarily change the `examQuestions` query's `.select(...)` (the second query in the `Promise.all`) to `.select('nonexistent_column_xyz')`. Reload the same exam URL — the exam header/sidebar should render normally, with "Some exam data failed to load. Please refresh." shown above the (now-empty) question builder. Revert the `.select(...)`.

- [ ] **Step 7: Commit**

```bash
git add "app/lecturer/exams/[id]/loading.js" "app/lecturer/exams/[id]/page.js"
git commit -m "feat: add exam detail loading skeleton and query error handling"
```

---

### Task 7: Exam results detail — loading skeleton + query error handling

**Files:**
- Create: `app/lecturer/exams/[id]/results/loading.js`
- Modify: `app/lecturer/exams/[id]/results/page.js`

**Interfaces:**
- Consumes: `Skeleton` (Task 1), `QueryErrorBanner` (Task 2).

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function ExamResultsLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <Skeleton className="h-4 w-20 mb-2" />

      <div className="mt-2 mb-6 space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-surface border border-border rounded-xl p-4 space-y-2">
            <Skeleton className="h-5 w-12 mx-auto" />
            <Skeleton className="h-3 w-16 mx-auto" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-surface border border-border rounded-xl p-5">
            <Skeleton className="h-4 w-40 mb-4" />
            <Skeleton className="h-28 w-full" />
          </div>
          <div className="bg-surface border border-border rounded-xl p-5 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
        <div className="space-y-5">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="bg-surface border border-border rounded-xl p-5 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Split the `exam` query's error from "not found"**

In `app/lecturer/exams/[id]/results/page.js`, add the import near the top:

```js
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
```

Change line 17 from:

```js
  const { data: exam } = await supabase
```

to:

```js
  const { data: exam, error: examError } = await supabase
```

Replace the existing not-found check (currently line 24):

```js
  if (!exam || exam.created_by !== user.id) notFound()
```

with:

```js
  if (examError) {
    console.error('[ExamResultsPage]', examError)
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <Link href={`/lecturer/exams/${id}`} className="text-sm text-text-muted hover:text-primary transition-colors">
          ← Back to Exam
        </Link>
        <div className="mt-4">
          <QueryErrorBanner message="Failed to load results for this exam. Please refresh." />
        </div>
      </div>
    )
  }

  if (!exam || exam.created_by !== user.id) notFound()
```

- [ ] **Step 3: Check the secondary queries' errors**

Change the remaining four queries (currently lines 26-55) from discarding `error` to capturing it, and log a combined check. Replace:

```js
  const { data: examQuestions } = await supabase
    .from('exam_questions')
    .select('marks')
    .eq('exam_id', id)

  const totalPossible = (examQuestions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)

  const { data: attempts } = await supabase
    .from('attempts')
    .select('id, status, submitted_at, total_score, users:student_id ( id, full_name, matric_number, level )')
    .eq('exam_id', id)
    .in('status', ['submitted', 'graded'])
    .order('total_score', { ascending: false, nullsFirst: false })

  const { data: results } = await supabase
    .from('results')
    .select('attempt_id, final_score, passed')
    .eq('exam_id', id)
```

with:

```js
  const { data: examQuestions, error: examQuestionsError } = await supabase
    .from('exam_questions')
    .select('marks')
    .eq('exam_id', id)

  const totalPossible = (examQuestions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)

  const { data: attempts, error: attemptsError } = await supabase
    .from('attempts')
    .select('id, status, submitted_at, total_score, users:student_id ( id, full_name, matric_number, level )')
    .eq('exam_id', id)
    .in('status', ['submitted', 'graded'])
    .order('total_score', { ascending: false, nullsFirst: false })

  const { data: results, error: resultsError } = await supabase
    .from('results')
    .select('attempt_id, final_score, passed')
    .eq('exam_id', id)
```

Then change:

```js
  const { data: allResponses } = attemptIds.length
    ? await supabase
        .from('responses')
        .select('question_id, is_correct, marks_awarded')
        .in('attempt_id', attemptIds)
    : { data: [] }
```

to:

```js
  const { data: allResponses, error: responsesError } = attemptIds.length
    ? await supabase
        .from('responses')
        .select('question_id, is_correct, marks_awarded')
        .in('attempt_id', attemptIds)
    : { data: [] }

  const dataError = examQuestionsError || attemptsError || resultsError || responsesError
  if (dataError) console.error('[ExamResultsPage]', dataError)
```

- [ ] **Step 4: Render the banner in place of the results content on secondary-query failure**

Replace the existing content ternary (currently lines 129-136):

```js
      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No submissions yet"
          description={exam.status === 'live' || exam.status === 'scheduled'
            ? "Students haven't submitted this exam yet."
            : 'No students completed this exam.'}
        />
      ) : (
```

with:

```js
      {dataError ? (
        <QueryErrorBanner message="Failed to load result data for this exam. Please refresh." />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No submissions yet"
          description={exam.status === 'live' || exam.status === 'scheduled'
            ? "Students haven't submitted this exam yet."
            : 'No students completed this exam.'}
        />
      ) : (
```

(The trailing `)}` that already closes this ternary, currently line 287, needs no change — it now closes three branches instead of two.)

- [ ] **Step 5: Manual verification — loading skeleton**

Run: `npm run dev`. Temporarily add `await new Promise(r => setTimeout(r, 2000))` as the first line inside `ExamResultsPage`. Visit `/lecturer/exams/<a closed or live exam id>/results` — skeleton renders for ~2s. Remove the `setTimeout` line.

- [ ] **Step 6: Manual verification — primary error banner**

Temporarily change the `exam` query's `.select(...)` to `.select('nonexistent_column_xyz')`. Reload the results URL — should show "← Back to Exam" plus "Failed to load results for this exam." banner. Revert.

- [ ] **Step 7: Manual verification — secondary error banner**

Temporarily change the `attempts` query's `.select(...)` to `.select('nonexistent_column_xyz')`. Reload the same URL — header/stats area (`exam.title`, badge) should render, with "Failed to load result data for this exam." shown in place of the score distribution/table/sidebar. Revert.

- [ ] **Step 8: Commit**

```bash
git add "app/lecturer/exams/[id]/results/loading.js" "app/lecturer/exams/[id]/results/page.js"
git commit -m "feat: add exam results loading skeleton and query error handling"
```

---

### Task 8: Questions list — loading skeleton + `courses` query error handling

**Files:**
- Create: `app/lecturer/questions/loading.js`
- Modify: `app/lecturer/questions/page.js`

**Interfaces:**
- Consumes: `Skeleton` (Task 1), `QueryErrorBanner` (Task 2, already wired for the primary query in Task 2).

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function QuestionsLoading() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-8 w-32" />
        </div>
      </header>

      <main className="flex-1 p-6 space-y-5">
        <div className="flex gap-3">
          <Skeleton className="h-9 w-full max-w-xs" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-surface border border-border rounded-xl p-5 space-y-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Check the `courses` query's error**

In `app/lecturer/questions/page.js`, change lines 21-25 from:

```js
  const { data: courses } = await supabase
    .from('courses')
    .select('id, course_code, course_title')
    .eq('university_id', user.university_id)
    .order('course_code')
```

to:

```js
  const { data: courses, error: coursesError } = await supabase
    .from('courses')
    .select('id, course_code, course_title')
    .eq('university_id', user.university_id)
    .order('course_code')
  if (coursesError) console.error('[QuestionsPage]', coursesError)
```

- [ ] **Step 3: Render a banner for the filter bar on `courses` failure**

Replace the existing `<QuestionsFilters courses={courses ?? []} />` line (currently line 61) with:

```js
        {coursesError && <QueryErrorBanner message="Failed to load course filters. Please refresh." />}
        <QuestionsFilters courses={courses ?? []} />
```

- [ ] **Step 4: Manual verification — loading skeleton**

Run: `npm run dev`. Temporarily add `await new Promise(r => setTimeout(r, 2000))` as the first line inside `QuestionsPage`. Visit `/lecturer/questions` — skeleton renders for ~2s. Remove the `setTimeout` line.

- [ ] **Step 5: Manual verification — courses error banner**

Temporarily change the `courses` query's `.select(...)` to `.select('nonexistent_column_xyz')`. Reload `/lecturer/questions` — "Failed to load course filters. Please refresh." should appear above the (now course-less, but still functional) filter bar, while the question grid below still renders normally. Revert.

- [ ] **Step 6: Commit**

```bash
git add app/lecturer/questions/loading.js app/lecturer/questions/page.js
git commit -m "feat: add questions list loading skeleton and courses query error handling"
```

---

### Task 9: Results overview — loading skeleton + query error handling

**Files:**
- Create: `app/lecturer/results/loading.js`
- Modify: `app/lecturer/results/page.js`

**Interfaces:**
- Consumes: `Skeleton` (Task 1), `QueryErrorBanner` (Task 2).

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function ResultsLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6 max-w-md">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>

      <div className="grid gap-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-5 space-y-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Check the primary `exams` query's error**

In `app/lecturer/results/page.js`, add the import near the top:

```js
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
```

Change lines 14-20 from:

```js
  const { data: exams } = await supabase
    .from('exams')
    .select('id, title, status, pass_mark, courses!course_id ( course_code, course_title ), exam_questions ( marks )')
    .eq('university_id', user.university_id)
    .eq('created_by', user.id)
    .in('status', ['live', 'closed'])
    .order('created_at', { ascending: false })
```

to:

```js
  const { data: exams, error: examsError } = await supabase
    .from('exams')
    .select('id, title, status, pass_mark, courses!course_id ( course_code, course_title ), exam_questions ( marks )')
    .eq('university_id', user.university_id)
    .eq('created_by', user.id)
    .in('status', ['live', 'closed'])
    .order('created_at', { ascending: false })

  if (examsError) {
    console.error('[ResultsPage]', examsError)
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-8">Results</h1>
        <QueryErrorBanner message="Failed to load results. Please refresh." />
      </div>
    )
  }
```

(This early return is placed before the existing `if (!exams?.length)` empty-state early return, so a query error is never mistaken for "no exams yet.")

- [ ] **Step 3: Check the secondary queries' errors**

Change lines 42-53 from:

```js
  const [{ data: attempts }, { data: results }] = await Promise.all([
    supabase
      .from('attempts')
      .select('id, exam_id, status, total_score, student_id')
      .in('exam_id', examIds)
      .in('status', ['submitted', 'graded']),

    supabase
      .from('results')
      .select('exam_id, student_id, final_score, passed')
      .in('exam_id', examIds),
  ])
```

to:

```js
  const [{ data: attempts, error: attemptsError }, { data: results, error: resultsError }] = await Promise.all([
    supabase
      .from('attempts')
      .select('id, exam_id, status, total_score, student_id')
      .in('exam_id', examIds)
      .in('status', ['submitted', 'graded']),

    supabase
      .from('results')
      .select('exam_id, student_id, final_score, passed')
      .in('exam_id', examIds),
  ])

  const secondaryError = attemptsError || resultsError
  if (secondaryError) console.error('[ResultsPage]', secondaryError)
```

- [ ] **Step 4: Render the banner above the summary cards on secondary-query failure**

Replace the opening of the "Platform summary" block (currently lines 93-95):

```js
      {/* Platform summary */}
      <div className="grid grid-cols-2 gap-4 mb-6 max-w-md">
        <SummaryCard label="Total Submissions" value={totalSubmissions} color="neutral" />
```

with:

```js
      {secondaryError && (
        <div className="mb-4">
          <QueryErrorBanner message="Some result data failed to load — figures below may be incomplete. Please refresh." />
        </div>
      )}

      {/* Platform summary */}
      <div className="grid grid-cols-2 gap-4 mb-6 max-w-md">
        <SummaryCard label="Total Submissions" value={totalSubmissions} color="neutral" />
```

(This one stays additive rather than replacing the exam list — unlike the other pages, the per-exam cards below are still individually meaningful even with missing attempts/results data for some of them, so hiding the whole list would remove more value than it protects.)

- [ ] **Step 5: Manual verification — loading skeleton**

Run: `npm run dev`. Temporarily add `await new Promise(r => setTimeout(r, 2000))` as the first line inside `LecturerResultsPage`. Visit `/lecturer/results` — skeleton renders for ~2s. Remove the `setTimeout` line.

- [ ] **Step 6: Manual verification — primary error banner**

Temporarily change the `exams` query's `.select(...)` to `.select('nonexistent_column_xyz')`. Reload `/lecturer/results` — should show the "Results" heading plus "Failed to load results. Please refresh." with nothing else. Revert.

- [ ] **Step 7: Manual verification — secondary error banner**

Temporarily change the `attempts` query's `.select(...)` to `.select('nonexistent_column_xyz')`. Reload `/lecturer/results` — the "Some result data failed to load…" banner should appear above the summary cards, with the exam cards below still rendering (likely showing "No submissions" since the attempts data is missing). Revert.

- [ ] **Step 8: Commit**

```bash
git add app/lecturer/results/loading.js app/lecturer/results/page.js
git commit -m "feat: add results overview loading skeleton and query error handling"
```

---

### Task 10: Full portal lint and build check

**Files:** none (verification only)

- [ ] **Step 1: Lint the whole repo**

Run: `npm run lint`
Expected: no errors introduced by any of the above tasks.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds — this catches any `loading.js`/`error.js` file exporting something other than a valid default component, and any leftover temporary `setTimeout`/`throw`/`nonexistent_column_xyz` debugging code left in from the manual verification steps across Tasks 4-9.

- [ ] **Step 3: Full click-through**

Run: `npm run dev`. As a lecturer, visit each of: `/lecturer/dashboard`, `/lecturer/exams`, `/lecturer/exams/<id>`, `/lecturer/exams/<id>/results`, `/lecturer/questions`, `/lecturer/results`. Confirm each renders normally with no leftover skeletons, banners, or console errors (open browser devtools console to check).

This step has no commit — it's a final gate confirming Tasks 1-9 didn't leave any temporary debugging code behind.
