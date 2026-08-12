# Admin, Super-Admin, and Lab Loading/Error State Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admin, super-admin, and the student lab flow the same loading-skeleton/error-boundary treatment the lecturer portal already has — direct reuse for admin/super-admin (identical shape to lecturer), an adapted hard-stop rule for lab (correctness-critical exam/score data, not dashboard stats).

**Architecture:** Reuses `components/ui/Skeleton.js` and `components/ui/QueryErrorBanner.js` (already built, no changes). One `loading.js` per route with a real query. One `error.js` per portal root (`app/admin/`, `app/super-admin/`, `app/lab/`). Admin/super-admin follow the lecturer plan's banner-in-place-of-content rule; lab pages hard-stop (no partial render) when a query touches exam-question or score integrity.

**Tech Stack:** Next.js App Router (loading.js/error.js file conventions), React Server Components, Supabase JS client, Tailwind CSS, lucide-react icons.

## Global Constraints

- No new npm dependencies, no new shared components.
- No changes to `app/super-admin/settings/page.js` (no Supabase query exists there).
- No changes to `app/lab/LabCodeEntry.js`, `MatricEntryForm.js`, `LabStartButton.js`, `EndSessionButton.js`, or `ExamInterface.js` — client-side mutation handling, out of scope.
- A query gets a `QueryErrorBanner` in place of its content only when failure would render as misleading data (a stat/count/list that looks real but isn't). A query feeding only a not-yet-open modal's dropdown (faculties/departments in `admin/courses`, `admin/structure`'s form column, `admin/users`) is logged via `console.error` with no dedicated banner.
- Lab flow pages hard-stop (no partial render of `ExamInterface` or a score) rather than banner-and-continue when the failed query is `exam_questions`, `responses` (attempt page), or `result`/`examQuestions` (result page).
- No automated tests — no React-rendering test setup in this repo. Verification is lint + `npm run build` + `npm test` (regression guard) + manual dev-server checks, same technique as the lecturer plan (temporary `setTimeout` for loading, temporary bad `.select()` for error).

---

### Task 1: `app/admin/error.js`

**Files:**
- Create: `app/admin/error.js`

- [ ] **Step 1: Create the boundary**

```js
'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

export default function AdminError({ error, reset }) {
  useEffect(() => {
    console.error('[AdminPortal]', error)
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
            href="/admin/dashboard"
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

- [ ] **Step 2: Lint**

Run: `npx eslint app/admin/error.js`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/admin/error.js
git commit -m "feat: add shared error boundary for admin portal"
```

---

### Task 2: `app/super-admin/error.js`

**Files:**
- Create: `app/super-admin/error.js`

- [ ] **Step 1: Create the boundary**

```js
'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

export default function SuperAdminError({ error, reset }) {
  useEffect(() => {
    console.error('[SuperAdminPortal]', error)
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
            href="/super-admin/dashboard"
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

- [ ] **Step 2: Lint**

Run: `npx eslint app/super-admin/error.js`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/super-admin/error.js
git commit -m "feat: add shared error boundary for super-admin portal"
```

---

### Task 3: `app/lab/error.js`

**Files:**
- Create: `app/lab/error.js`

**Interfaces:** No "back to dashboard" link (unlike Tasks 1-2) — a mid-exam student shouldn't be nudged away from their attempt, and there's no natural destination in a kiosk session.

- [ ] **Step 1: Create the boundary**

```js
'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'

export default function LabError({ error, reset }) {
  useEffect(() => {
    console.error('[LabPortal]', error)
  }, [error])

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-danger-light mb-4">
          <AlertTriangle className="size-7 text-danger" />
        </span>
        <h1 className="text-base font-semibold text-text-primary mb-1">Something went wrong</h1>
        <p className="text-sm text-text-secondary mb-6">
          An unexpected error occurred. Please try again.
        </p>
        <button
          onClick={() => reset()}
          className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npx eslint app/lab/error.js`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/lab/error.js
git commit -m "feat: add shared error boundary for lab portal"
```

---

### Task 4: Admin dashboard — loading skeleton + query error handling

**Files:**
- Create: `app/admin/dashboard/loading.js`
- Modify: `app/admin/dashboard/page.js`

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function AdminDashboardLoading() {
  return (
    <div className="h-full flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-40" />
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            </div>
            <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
              <Skeleton className="h-4 w-32 mb-2" />
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </div>

          <div className="space-y-5">
            <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-full" />
              <div className="grid grid-cols-2 gap-3">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            </div>
            <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Check errors on all data sources**

In `app/admin/dashboard/page.js`, add the import near the top:

```js
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
```

Change the `Promise.all` destructuring (currently lines 17-27) from:

```js
  const [
    { count: lecturerCount },
    { count: studentCount },
    { count: activeExamCount },
    { count: courseCount },
    { count: deptCount },
    { data: recentExams },
    { data: departments },
    { data: allResults },
    { data: closedExams },
  ] = await Promise.all([
```

to:

```js
  const [
    { count: lecturerCount, error: lecturerCountError },
    { count: studentCount, error: studentCountError },
    { count: activeExamCount, error: activeExamCountError },
    { count: courseCount, error: courseCountError },
    { count: deptCount, error: deptCountError },
    { data: recentExams, error: recentExamsError },
    { data: departments, error: departmentsError },
    { data: allResults },
    { data: closedExams, error: closedExamsError },
  ] = await Promise.all([
```

(`allResults` stays as-is — same unused placeholder-subquery pattern as the lecturer dashboard, immediately superseded by `uniResults` below.)

Change the two follow-up queries (currently lines 68-82) from:

```js
  const uniExamIds = (closedExams ?? []).map(e => e.id)
  const { data: uniResults } = uniExamIds.length
    ? await supabase
        .from('results')
        .select('passed')
        .in('exam_id', uniExamIds)
    : { data: [] }

  // Dept user counts
  const { data: deptUsers } = await supabase
    .from('users')
    .select('department_id, role')
    .eq('university_id', user.university_id)
    .eq('is_active', true)
    .in('role', ['student', 'lecturer'])
```

to:

```js
  const uniExamIds = (closedExams ?? []).map(e => e.id)
  const { data: uniResults, error: uniResultsError } = uniExamIds.length
    ? await supabase
        .from('results')
        .select('passed')
        .in('exam_id', uniExamIds)
    : { data: [] }

  // Dept user counts
  const { data: deptUsers, error: deptUsersError } = await supabase
    .from('users')
    .select('department_id, role')
    .eq('university_id', user.university_id)
    .eq('is_active', true)
    .in('role', ['student', 'lecturer'])

  const dashboardError = lecturerCountError || studentCountError || activeExamCountError ||
    courseCountError || deptCountError || recentExamsError || departmentsError ||
    closedExamsError || uniResultsError || deptUsersError
  if (dashboardError) console.error('[AdminDashboardPage]', dashboardError)
```

- [ ] **Step 3: Guard the main content grid**

Change (currently lines 135-136):

```js
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left col */}
```

to:

```js
        {dashboardError ? (
          <QueryErrorBanner message="Failed to load dashboard data. Please refresh." />
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left col */}
```

Find the matching closing tag (currently lines 274-276):

```js
          </div>
        </div>
      </main>
```

and add the matching closing `)}`:

```js
          </div>
        </div>
        )}
      </main>
```

- [ ] **Step 4: Lint**

Run: `npx eslint app/admin/dashboard/loading.js app/admin/dashboard/page.js`
Expected: no errors.

- [ ] **Step 5: Manual verification — loading skeleton**

Run: `npm run dev`. Temporarily add `await new Promise(r => setTimeout(r, 2000))` as the first line inside `AdminDashboardPage`. Visit `/admin/dashboard` as a school_admin — skeleton renders ~2s, no layout jump. Remove the line.

- [ ] **Step 6: Manual verification — error banner**

Temporarily change the `recentExams` query's `.select(...)` in the `Promise.all` to `.select('nonexistent_column_xyz')`. Reload `/admin/dashboard` — stat cards still show (with fallback values), banner replaces everything below them. Revert.

- [ ] **Step 7: Commit**

```bash
git add app/admin/dashboard/loading.js app/admin/dashboard/page.js
git commit -m "feat: add admin dashboard loading skeleton and query error handling"
```

---

### Task 5: Admin courses — loading skeleton + query error handling

**Files:**
- Create: `app/admin/courses/loading.js`
- Modify: `app/admin/courses/page.js`

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function AdminCoursesLoading() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl space-y-6">
        <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
          <Skeleton className="h-4 w-32" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>

        <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Check errors on both queries**

In `app/admin/courses/page.js`, add the import near the top:

```js
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
```

Change (currently lines 15-26):

```js
  const [{ data: courses }, { data: departments }] = await Promise.all([
    supabase
      .from('courses')
      .select('id, course_code, course_title, credit_units, level, semester, departments ( name, faculties ( name ) )')
      .eq('university_id', user.university_id)
      .order('course_code'),
    supabase
      .from('departments')
      .select('id, name')
      .eq('university_id', user.university_id)
      .order('name'),
  ])
```

to:

```js
  const [
    { data: courses, error: coursesError },
    { data: departments, error: departmentsError },
  ] = await Promise.all([
    supabase
      .from('courses')
      .select('id, course_code, course_title, credit_units, level, semester, departments ( name, faculties ( name ) )')
      .eq('university_id', user.university_id)
      .order('course_code'),
    supabase
      .from('departments')
      .select('id, name')
      .eq('university_id', user.university_id)
      .order('name'),
  ])
  if (coursesError) console.error('[AdminCoursesPage]', coursesError)
  // departments only feeds CreateCourseForm's dropdown — logged, not bannered (see plan Global Constraints)
  if (departmentsError) console.error('[AdminCoursesPage]', departmentsError)
```

- [ ] **Step 3: Guard the table**

Change (currently lines 37-77):

```js
        {!courses?.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
            <BookOpen size={32} className="text-text-muted mb-3" />
            <p className="text-sm font-medium text-text-primary mb-1">No courses yet</p>
            <p className="text-xs text-text-muted">Add your first course using the form above.</p>
          </div>
        ) : (
```

to:

```js
        {coursesError ? (
          <QueryErrorBanner message="Failed to load courses. Please refresh." />
        ) : !courses?.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
            <BookOpen size={32} className="text-text-muted mb-3" />
            <p className="text-sm font-medium text-text-primary mb-1">No courses yet</p>
            <p className="text-xs text-text-muted">Add your first course using the form above.</p>
          </div>
        ) : (
```

- [ ] **Step 4: Lint**

Run: `npx eslint app/admin/courses/loading.js app/admin/courses/page.js`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Loading: add a 2s `setTimeout` at the top of `AdminCoursesPage`, confirm skeleton, remove it. Error: temporarily change the `courses` query's `.select(...)` to `.select('nonexistent_column_xyz')`, reload `/admin/courses`, confirm the banner replaces the table (the `CreateCourseForm` above it still renders). Revert.

- [ ] **Step 6: Commit**

```bash
git add app/admin/courses/loading.js app/admin/courses/page.js
git commit -m "feat: add admin courses loading skeleton and query error handling"
```

---

### Task 6: Admin exams — loading skeleton + query error handling

**Files:**
- Create: `app/admin/exams/loading.js`
- Modify: `app/admin/exams/page.js`

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function AdminExamsLoading() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
      </header>

      <main className="flex-1 p-6">
        <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Check errors on both queries**

In `app/admin/exams/page.js`, add the import near the top:

```js
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
```

Change (currently lines 16-35):

```js
  const { data: exams } = await supabase
    .from('exams')
    .select(`
      id, title, status, exam_type, academic_session, semester,
      courses ( course_code ),
      users:created_by ( full_name ),
      exam_questions ( id )
    `)
    .eq('university_id', user.university_id)
    .order('created_at', { ascending: false })

  // Count attempts per exam
  const examIds = (exams ?? []).map(e => e.id)
  const { data: attemptCounts } = examIds.length
    ? await supabase
        .from('attempts')
        .select('exam_id')
        .in('exam_id', examIds)
        .in('status', ['submitted', 'graded'])
    : { data: [] }
```

to:

```js
  const { data: exams, error: examsError } = await supabase
    .from('exams')
    .select(`
      id, title, status, exam_type, academic_session, semester,
      courses ( course_code ),
      users:created_by ( full_name ),
      exam_questions ( id )
    `)
    .eq('university_id', user.university_id)
    .order('created_at', { ascending: false })
  if (examsError) console.error('[AdminExamsPage]', examsError)

  // Count attempts per exam
  const examIds = (exams ?? []).map(e => e.id)
  const { data: attemptCounts, error: attemptCountsError } = examIds.length
    ? await supabase
        .from('attempts')
        .select('exam_id')
        .in('exam_id', examIds)
        .in('status', ['submitted', 'graded'])
    : { data: [] }
  if (attemptCountsError) console.error('[AdminExamsPage]', attemptCountsError)
```

- [ ] **Step 3: Guard the table and the submissions column**

Change (currently lines 49-98):

```js
        {!exams?.length ? (
          <EmptyState
            icon={ClipboardList}
            title="No exams yet"
            description="Exams created by lecturers will appear here."
          />
        ) : (
```

to:

```js
        {examsError ? (
          <QueryErrorBanner message="Failed to load exams. Please refresh." />
        ) : !exams?.length ? (
          <EmptyState
            icon={ClipboardList}
            title="No exams yet"
            description="Exams created by lecturers will appear here."
          />
        ) : (
```

Change the submissions cell (currently lines 90-92):

```js
                    <td className="px-4 py-3 text-right text-text-secondary hidden lg:table-cell">
                      {countMap[exam.id] ?? 0}
                    </td>
```

to:

```js
                    <td className="px-4 py-3 text-right text-text-secondary hidden lg:table-cell">
                      {attemptCountsError ? '—' : (countMap[exam.id] ?? 0)}
                    </td>
```

- [ ] **Step 4: Add an attempt-counts banner above the table**

Change the wrapping `<main>` open (currently line 48):

```js
      <main className="flex-1 p-6">
```

to:

```js
      <main className="flex-1 p-6 space-y-4">
        {attemptCountsError && !examsError && (
          <QueryErrorBanner message="Submission counts failed to load — showing '—' below. Please refresh." />
        )}
```

- [ ] **Step 5: Lint**

Run: `npx eslint app/admin/exams/loading.js app/admin/exams/page.js`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`. Loading: 2s `setTimeout` at the top of `AdminExamsPage`, confirm skeleton, remove it. Primary error: break the `exams` query's `.select(...)`, reload `/admin/exams`, confirm the banner replaces the table. Revert. Secondary error: break the `attemptCounts` query's `.select(...)` (`.select('nonexistent_column_xyz')`), reload, confirm the small banner appears above the table and every submissions cell shows `—`. Revert.

- [ ] **Step 7: Commit**

```bash
git add app/admin/exams/loading.js app/admin/exams/page.js
git commit -m "feat: add admin exams loading skeleton and query error handling"
```

---

### Task 7: Admin logs — loading skeleton + query error handling

**Files:**
- Create: `app/admin/logs/loading.js`
- Modify: `app/admin/logs/page.js`

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function AdminLogsLoading() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-56" />
        </div>
      </header>

      <main className="flex-1 p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Check the query's error**

In `app/admin/logs/page.js`, add the import near the top:

```js
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
```

Change (currently line 50):

```js
  const { data: logs } = await query
```

to:

```js
  const { data: logs, error } = await query
  if (error) console.error('[AdminLogsPage]', error)
```

- [ ] **Step 3: Guard the table**

Change (currently lines 71-104):

```js
        {!logs?.length ? (
          <EmptyState icon={History} title="No activity yet" description="Account actions and sign-ins will appear here." />
        ) : (
```

to:

```js
        {error ? (
          <QueryErrorBanner message="Failed to load activity log. Please refresh." />
        ) : !logs?.length ? (
          <EmptyState icon={History} title="No activity yet" description="Account actions and sign-ins will appear here." />
        ) : (
```

- [ ] **Step 4: Lint**

Run: `npx eslint app/admin/logs/loading.js app/admin/logs/page.js`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Loading: 2s `setTimeout` at the top of `AdminLogsPage`, confirm skeleton, remove it. Error: break the query's `.select(...)`, reload `/admin/logs`, confirm the banner replaces the table (filter form above it still renders). Revert.

- [ ] **Step 6: Commit**

```bash
git add app/admin/logs/loading.js app/admin/logs/page.js
git commit -m "feat: add admin logs loading skeleton and query error handling"
```

---

### Task 8: Admin structure — loading skeleton + query error handling

**Files:**
- Create: `app/admin/structure/loading.js`
- Modify: `app/admin/structure/page.js`

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function AdminStructureLoading() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </header>

      <main className="flex-1 p-6">
        <div className="max-w-4xl grid lg:grid-cols-3 gap-6">
          <div className="space-y-3">
            <Skeleton className="h-4 w-28 mb-2" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
          <div className="lg:col-span-2 space-y-3">
            <Skeleton className="h-4 w-40 mb-2" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Check errors on both queries**

In `app/admin/structure/page.js`, add the import near the top:

```js
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
```

Change (currently lines 13-24):

```js
  const [{ data: faculties }, { data: departments }] = await Promise.all([
    supabase
      .from('faculties')
      .select('id, name')
      .eq('university_id', user.university_id)
      .order('name'),
    supabase
      .from('departments')
      .select('id, name, faculty_id')
      .eq('university_id', user.university_id)
      .order('name'),
  ])
```

to:

```js
  const [
    { data: faculties, error: facultiesError },
    { data: departments, error: departmentsError },
  ] = await Promise.all([
    supabase
      .from('faculties')
      .select('id, name')
      .eq('university_id', user.university_id)
      .order('name'),
    supabase
      .from('departments')
      .select('id, name, faculty_id')
      .eq('university_id', user.university_id)
      .order('name'),
  ])

  const structureError = facultiesError || departmentsError
  if (structureError) console.error('[AdminStructurePage]', structureError)
```

- [ ] **Step 3: Guard the "Current Structure" column**

Change (currently lines 58-88, the ternary inside the `lg:col-span-2` column):

```js
            {!faculties?.length ? (
              <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
                <Building2 size={32} className="text-text-muted mb-3" />
                <p className="text-sm font-medium text-text-primary mb-1">No structure yet</p>
                <p className="text-xs text-text-muted">Add your first faculty to get started.</p>
              </div>
            ) : (
```

to:

```js
            {structureError ? (
              <QueryErrorBanner message="Failed to load faculties and departments. Please refresh." />
            ) : !faculties?.length ? (
              <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
                <Building2 size={32} className="text-text-muted mb-3" />
                <p className="text-sm font-medium text-text-primary mb-1">No structure yet</p>
                <p className="text-xs text-text-muted">Add your first faculty to get started.</p>
              </div>
            ) : (
```

- [ ] **Step 4: Lint**

Run: `npx eslint app/admin/structure/loading.js app/admin/structure/page.js`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Loading: 2s `setTimeout` at the top of `AdminStructurePage`, confirm skeleton, remove it. Error: break the `faculties` query's `.select(...)`, reload `/admin/structure`, confirm the banner replaces the structure tree (the "Add Structure" forms column still renders). Revert.

- [ ] **Step 6: Commit**

```bash
git add app/admin/structure/loading.js app/admin/structure/page.js
git commit -m "feat: add admin structure loading skeleton and query error handling"
```

---

### Task 9: Admin users — loading skeleton + query error handling

**Files:**
- Create: `app/admin/users/loading.js`
- Modify: `app/admin/users/page.js`

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function AdminUsersLoading() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-32" />
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 space-y-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="h-8 w-full" />
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Check errors on all three queries**

In `app/admin/users/page.js`, add the import near the top:

```js
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
```

Change (currently lines 21-39):

```js
  const [{ data: users }, { data: faculties }, { data: departments }] = await Promise.all([
    supabase
      .from('users')
      .select('id, full_name, email, role, matric_number, level, is_active, created_at, departments ( name )')
      .eq('university_id', user.university_id)
      .neq('id', user.id)
      .order('role')
      .order('full_name'),
    supabase
      .from('faculties')
      .select('id, name')
      .eq('university_id', user.university_id)
      .order('name'),
    supabase
      .from('departments')
      .select('id, name, faculties ( name )')
      .eq('university_id', user.university_id)
      .order('name'),
  ])
```

to:

```js
  const [
    { data: users, error: usersError },
    { data: faculties, error: facultiesError },
    { data: departments, error: departmentsError },
  ] = await Promise.all([
    supabase
      .from('users')
      .select('id, full_name, email, role, matric_number, level, is_active, created_at, departments ( name )')
      .eq('university_id', user.university_id)
      .neq('id', user.id)
      .order('role')
      .order('full_name'),
    supabase
      .from('faculties')
      .select('id, name')
      .eq('university_id', user.university_id)
      .order('name'),
    supabase
      .from('departments')
      .select('id, name, faculties ( name )')
      .eq('university_id', user.university_id)
      .order('name'),
  ])
  if (usersError) console.error('[AdminUsersPage]', usersError)
  // faculties/departments only feed the invite/bulk-upload modal dropdowns — logged, not bannered
  if (facultiesError) console.error('[AdminUsersPage]', facultiesError)
  if (departmentsError) console.error('[AdminUsersPage]', departmentsError)
```

- [ ] **Step 3: Guard the role-grouped sections**

Change (currently line 68):

```js
      <main className="flex-1 p-6 space-y-8">
        {Object.entries(grouped).map(([role, roleUsers]) => (
```

to:

```js
      <main className="flex-1 p-6 space-y-8">
        {usersError && <QueryErrorBanner message="Failed to load users. Please refresh." />}
        {!usersError && Object.entries(grouped).map(([role, roleUsers]) => (
```

- [ ] **Step 4: Lint**

Run: `npx eslint app/admin/users/loading.js app/admin/users/page.js`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Loading: 2s `setTimeout` at the top of `AdminUsersPage`, confirm skeleton, remove it. Error: break the `users` query's `.select(...)`, reload `/admin/users`, confirm the banner replaces all three role sections (the invite/upload buttons in the header still render). Revert.

- [ ] **Step 6: Commit**

```bash
git add app/admin/users/loading.js app/admin/users/page.js
git commit -m "feat: add admin users loading skeleton and query error handling"
```

---

### Task 10: Super-admin dashboard — loading skeleton + query error handling

**Files:**
- Create: `app/super-admin/dashboard/loading.js`
- Modify: `app/super-admin/dashboard/page.js`

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function SuperAdminDashboardLoading() {
  return (
    <div className="h-full flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-48" />
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
          <div className="lg:col-span-2 space-y-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-5 space-y-3">
                <Skeleton className="h-4 w-32 mb-1" />
                <div className="grid grid-cols-4 gap-3">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <Skeleton key={j} className="h-14" />
                  ))}
                </div>
              </div>
            ))}
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

- [ ] **Step 2: Check errors on all data sources**

In `app/super-admin/dashboard/page.js`, add the import near the top:

```js
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
```

Change the `Promise.all` destructuring (currently lines 15-23) from:

```js
  const [
    { data: universities },
    { count: totalUsers },
    { count: totalExams },
    { count: liveExams },
    { data: allUsers },
    { data: allResults },
    { data: recentExams },
  ] = await Promise.all([
```

to:

```js
  const [
    { data: universities, error: universitiesError },
    { count: totalUsers, error: totalUsersError },
    { count: totalExams, error: totalExamsError },
    { count: liveExams, error: liveExamsError },
    { data: allUsers, error: allUsersError },
    { data: allResults, error: allResultsError },
    { data: recentExams, error: recentExamsError },
  ] = await Promise.all([
```

Change the follow-up query (currently lines 59-61) from:

```js
  const { data: allExams } = await supabase
    .from('exams')
    .select('university_id, status')
```

to:

```js
  const { data: allExams, error: allExamsError } = await supabase
    .from('exams')
    .select('university_id, status')

  const dashboardError = universitiesError || totalUsersError || totalExamsError ||
    liveExamsError || allUsersError || allResultsError || recentExamsError || allExamsError
  if (dashboardError) console.error('[SuperAdminDashboardPage]', dashboardError)
```

- [ ] **Step 3: Guard the main content grid**

Change (currently lines 116-117):

```js
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* University cards */}
```

to:

```js
        {dashboardError ? (
          <QueryErrorBanner message="Failed to load dashboard data. Please refresh." />
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* University cards */}
```

Find the matching closing tag (currently lines 235-237):

```js
          </div>
        </div>
      </main>
```

and add the matching closing `)}`:

```js
          </div>
        </div>
        )}
      </main>
```

- [ ] **Step 4: Lint**

Run: `npx eslint app/super-admin/dashboard/loading.js app/super-admin/dashboard/page.js`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Loading: 2s `setTimeout` at the top of `SuperAdminDashboardPage`, confirm skeleton, remove it. Error: break the `universities` query's `.select(...)`, reload `/super-admin/dashboard`, confirm stat cards still show and the banner replaces everything below. Revert.

- [ ] **Step 6: Commit**

```bash
git add app/super-admin/dashboard/loading.js app/super-admin/dashboard/page.js
git commit -m "feat: add super-admin dashboard loading skeleton and query error handling"
```

---

### Task 11: Super-admin logs — loading skeleton + query error handling

**Files:**
- Create: `app/super-admin/logs/loading.js`
- Modify: `app/super-admin/logs/page.js`

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function SuperAdminLogsLoading() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-64" />
        </div>
      </header>

      <main className="flex-1 p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Check the query's error**

In `app/super-admin/logs/page.js`, add the import near the top:

```js
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
```

Change (currently line 48):

```js
  const { data: logs } = await query
```

to:

```js
  const { data: logs, error } = await query
  if (error) console.error('[SuperAdminLogsPage]', error)
```

- [ ] **Step 3: Guard the table**

Change (currently lines 69-106):

```js
        {!logs?.length ? (
          <EmptyState icon={History} title="No activity yet" description="Account actions and sign-ins will appear here." />
        ) : (
```

to:

```js
        {error ? (
          <QueryErrorBanner message="Failed to load activity log. Please refresh." />
        ) : !logs?.length ? (
          <EmptyState icon={History} title="No activity yet" description="Account actions and sign-ins will appear here." />
        ) : (
```

- [ ] **Step 4: Lint**

Run: `npx eslint app/super-admin/logs/loading.js app/super-admin/logs/page.js`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Loading: 2s `setTimeout` at the top of `SuperAdminLogsPage`, confirm skeleton, remove it. Error: break the query's `.select(...)`, reload `/super-admin/logs`, confirm the banner replaces the table. Revert.

- [ ] **Step 6: Commit**

```bash
git add app/super-admin/logs/loading.js app/super-admin/logs/page.js
git commit -m "feat: add super-admin logs loading skeleton and query error handling"
```

---

### Task 12: Super-admin universities — loading skeleton + query error handling

**Files:**
- Create: `app/super-admin/universities/loading.js`
- Modify: `app/super-admin/universities/page.js`

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function SuperAdminUniversitiesLoading() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl space-y-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Check errors on both queries**

In `app/super-admin/universities/page.js`, add the import near the top:

```js
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
```

Change (currently lines 13-25) from:

```js
  const { data: universities } = await supabase
    .from('universities')
    .select('id, name, subdomain, created_at')
    .order('name')

  // Count users per university
  const uniIds = (universities ?? []).map(u => u.id)
  const { data: userCounts } = uniIds.length
    ? await supabase
        .from('users')
        .select('university_id, role')
        .in('university_id', uniIds)
    : { data: [] }
```

to:

```js
  const { data: universities, error: universitiesError } = await supabase
    .from('universities')
    .select('id, name, subdomain, created_at')
    .order('name')
  if (universitiesError) console.error('[SuperAdminUniversitiesPage]', universitiesError)

  // Count users per university
  const uniIds = (universities ?? []).map(u => u.id)
  const { data: userCounts, error: userCountsError } = uniIds.length
    ? await supabase
        .from('users')
        .select('university_id, role')
        .in('university_id', uniIds)
    : { data: [] }
  if (userCountsError) console.error('[SuperAdminUniversitiesPage]', userCountsError)
```

- [ ] **Step 3: Guard the list and the per-university counts**

Change (currently lines 44-83):

```js
        {!universities?.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
            <Building2 size={32} className="text-text-muted mb-3" />
            <p className="text-sm font-medium text-text-primary mb-1">No universities yet</p>
            <p className="text-xs text-text-muted">Add your first institution above.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {universities.map(uni => {
              const counts = countMap[uni.id] ?? { total: 0, students: 0, lecturers: 0 }
              return (
                <div key={uni.id} className="bg-surface border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-primary-light shrink-0">
                      <Building2 size={18} className="text-primary" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">{uni.name}</p>
                      <p className="text-xs font-mono text-text-muted">{uni.subdomain}.oems.edu</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-center shrink-0">
                    <div>
                      <p className="text-lg font-bold text-text-primary tabular-nums">{counts.lecturers}</p>
                      <p className="text-xs text-text-muted">Lecturers</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-text-primary tabular-nums">{counts.students}</p>
                      <p className="text-xs text-text-muted">Students</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-text-primary tabular-nums">{counts.total}</p>
                      <p className="text-xs text-text-muted">Total Users</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
```

to:

```js
        {universitiesError ? (
          <QueryErrorBanner message="Failed to load universities. Please refresh." />
        ) : !universities?.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
            <Building2 size={32} className="text-text-muted mb-3" />
            <p className="text-sm font-medium text-text-primary mb-1">No universities yet</p>
            <p className="text-xs text-text-muted">Add your first institution above.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {userCountsError && (
              <QueryErrorBanner message="Failed to load user counts. Please refresh." />
            )}
            <div className="grid gap-4">
              {universities.map(uni => {
                const counts = countMap[uni.id] ?? { total: 0, students: 0, lecturers: 0 }
                return (
                  <div key={uni.id} className="bg-surface border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="flex size-10 items-center justify-center rounded-xl bg-primary-light shrink-0">
                        <Building2 size={18} className="text-primary" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text-primary truncate">{uni.name}</p>
                        <p className="text-xs font-mono text-text-muted">{uni.subdomain}.oems.edu</p>
                      </div>
                    </div>
                    {!userCountsError && (
                      <div className="flex items-center gap-6 text-center shrink-0">
                        <div>
                          <p className="text-lg font-bold text-text-primary tabular-nums">{counts.lecturers}</p>
                          <p className="text-xs text-text-muted">Lecturers</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-text-primary tabular-nums">{counts.students}</p>
                          <p className="text-xs text-text-muted">Students</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-text-primary tabular-nums">{counts.total}</p>
                          <p className="text-xs text-text-muted">Total Users</p>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
```

- [ ] **Step 4: Lint**

Run: `npx eslint app/super-admin/universities/loading.js app/super-admin/universities/page.js`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Loading: 2s `setTimeout` at the top of `SuperAdminUniversitiesPage`, confirm skeleton, remove it. Primary error: break the `universities` query's `.select(...)`, reload `/super-admin/universities`, confirm the banner replaces the whole list. Revert. Secondary error: break the `userCounts` query's `.select(...)` instead, reload, confirm each university card still shows its name/subdomain with no counts, and one banner appears above the list. Revert.

- [ ] **Step 6: Commit**

```bash
git add app/super-admin/universities/loading.js app/super-admin/universities/page.js
git commit -m "feat: add super-admin universities loading skeleton and query error handling"
```

---

### Task 13: Super-admin users — loading skeleton + query error handling

**Files:**
- Create: `app/super-admin/users/loading.js`
- Modify: `app/super-admin/users/page.js`

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function SuperAdminUsersLoading() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-48" />
        </div>
      </header>

      <main className="flex-1 p-6">
        <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Check the query's error**

In `app/super-admin/users/page.js`, add the import near the top:

```js
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
```

Change (currently lines 28-33) from:

```js
  const { data: users } = await supabase
    .from('users')
    .select('id, full_name, email, role, matric_number, is_active, removed_at, created_at, universities ( name )')
    .neq('id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)
```

to:

```js
  const { data: users, error } = await supabase
    .from('users')
    .select('id, full_name, email, role, matric_number, is_active, removed_at, created_at, universities ( name )')
    .neq('id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) console.error('[SuperAdminUsersPage]', error)
```

- [ ] **Step 3: Guard the table**

Change (currently lines 42-98):

```js
        {!users?.length ? (
          <EmptyState icon={Users} title="No users yet" description="Users appear here once universities are set up." />
        ) : (
```

to:

```js
        {error ? (
          <QueryErrorBanner message="Failed to load users. Please refresh." />
        ) : !users?.length ? (
          <EmptyState icon={Users} title="No users yet" description="Users appear here once universities are set up." />
        ) : (
```

- [ ] **Step 4: Lint**

Run: `npx eslint app/super-admin/users/loading.js app/super-admin/users/page.js`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Loading: 2s `setTimeout` at the top of `SuperAdminUsersPage`, confirm skeleton, remove it. Error: break the query's `.select(...)`, reload `/super-admin/users`, confirm the banner replaces the table. Revert.

- [ ] **Step 6: Commit**

```bash
git add app/super-admin/users/loading.js app/super-admin/users/page.js
git commit -m "feat: add super-admin users loading skeleton and query error handling"
```

---

### Task 14: Lab lobby — loading skeleton + query error handling

**Files:**
- Create: `app/lab/[code]/loading.js`
- Modify: `app/lab/[code]/page.js`

**Interfaces:** No `QueryErrorBanner` here — the lab flow uses inline centered messages per the design (kiosk layout, no sidebar context, each message is a one-off).

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function LabLobbyLoading() {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-xl space-y-6">
        <Skeleton className="h-7 w-40 mx-auto" />
        <div className="text-center space-y-2">
          <Skeleton className="h-4 w-32 mx-auto" />
          <Skeleton className="h-8 w-64 mx-auto" />
          <Skeleton className="h-4 w-48 mx-auto" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-11 w-40 mx-auto rounded-xl" />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Split the `examBasic` lookup's error from "not found"**

In `app/lab/[code]/page.js`, change (currently lines 22-29):

```js
  const adminClient = createAdminClient()
  const { data: examBasic } = await adminClient
    .from('exams')
    .select('id')
    .eq('access_code', upperCode)
    .maybeSingle()

  if (!examBasic) notFound()
```

to:

```js
  const adminClient = createAdminClient()
  const { data: examBasic, error: examBasicError } = await adminClient
    .from('exams')
    .select('id')
    .eq('access_code', upperCode)
    .maybeSingle()

  if (examBasicError) {
    console.error('[LabLobbyPage]', examBasicError)
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-sm text-text-muted">Failed to load this exam. Please refresh.</p>
      </div>
    )
  }

  if (!examBasic) notFound()
```

- [ ] **Step 3: Split the main `exam` query's error from "not found", check the stats and attempt-check queries**

Change (currently lines 59-70):

```js
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
```

to:

```js
  const { data: exam, error: examError } = await supabase
    .from('exams')
    .select(`
      id, title, status, exam_type, academic_session, semester,
      duration_minutes, pass_mark, instructions,
      show_calculator, tips,
      courses!course_id ( course_code, course_title )
    `)
    .eq('access_code', upperCode)
    .single()

  if (examError) {
    console.error('[LabLobbyPage]', examError)
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-sm text-text-muted">Failed to load this exam. Please refresh.</p>
      </div>
    )
  }

  if (!exam) notFound()
```

Change (currently lines 87-93):

```js
  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, status')
    .eq('exam_id', exam.id)
    .eq('student_id', user.id)
    .maybeSingle()

  if (attempt?.status === 'in_progress') {
```

to:

```js
  const { data: attempt, error: attemptError } = await supabase
    .from('attempts')
    .select('id, status')
    .eq('exam_id', exam.id)
    .eq('student_id', user.id)
    .maybeSingle()
  // A failure here just means the "Start Exam" CTA shows instead of an
  // automatic redirect — startExam() independently re-checks for an
  // in-progress attempt and resumes it, so there's no correctness impact.
  if (attemptError) console.error('[LabLobbyPage]', attemptError)

  if (attempt?.status === 'in_progress') {
```

Change (currently lines 99-105):

```js
  const { data: examQuestions } = await supabase
    .from('exam_questions')
    .select('marks')
    .eq('exam_id', exam.id)

  const questionCount = examQuestions?.length ?? 0
  const totalMarks    = (examQuestions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)
```

to:

```js
  const { data: examQuestions, error: examQuestionsError } = await supabase
    .from('exam_questions')
    .select('marks')
    .eq('exam_id', exam.id)
  if (examQuestionsError) console.error('[LabLobbyPage]', examQuestionsError)

  const questionCount = examQuestions?.length ?? 0
  const totalMarks    = (examQuestions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)
```

- [ ] **Step 4: Hide the stats row on a stats-query failure**

Change (currently lines 140-156):

```js
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
```

to:

```js
        {/* Stats */}
        {!examQuestionsError && (
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
        )}
```

- [ ] **Step 5: Lint**

Run: `npx eslint "app/lab/[code]/loading.js" "app/lab/[code]/page.js"`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`. You'll need a real lab access code (from a lecturer's exam with a generated access code) and a matric-authenticated session to reach the post-auth branch — use one from local test data. Loading: 2s `setTimeout` right after `const { code } = await params`, confirm skeleton, remove it. Primary error: break the `exam` query's `.select(...)`, reload, confirm the centered "Failed to load this exam" message. Revert. Secondary error: break the `exam_questions` query's `.select(...)`, reload, confirm the stats row is hidden but the exam title/CTA still show. Revert.

- [ ] **Step 7: Commit**

```bash
git add "app/lab/[code]/loading.js" "app/lab/[code]/page.js"
git commit -m "feat: add lab lobby loading skeleton and query error handling"
```

---

### Task 15: Lab attempt — loading skeleton + hard-stop on exam-data failure

**Files:**
- Create: `app/lab/[code]/attempt/[attemptId]/loading.js`
- Modify: `app/lab/[code]/attempt/[attemptId]/page.js`

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function LabAttemptLoading() {
  return (
    <div className="flex-1 flex flex-col">
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="flex-1 p-6 max-w-3xl mx-auto w-full space-y-4">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-4/5" />
        <div className="space-y-2 mt-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Split the `exam`/`attempt` queries' errors from "not found"**

In `app/lab/[code]/attempt/[attemptId]/page.js`, change (currently lines 15-34):

```js
  const { data: exam } = await supabase
    .from('exams')
    .select(`
      id, title, status, duration_minutes, pass_mark,
      randomise_questions, randomise_options,
      show_calculator, tips, proctoring_enabled, access_code
    `)
    .eq('access_code', code.toUpperCase())
    .single()

  if (!exam) notFound()

  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, exam_id, status, started_at, student_id')
    .eq('id', attemptId)
    .eq('student_id', user.id)
    .single()

  if (!attempt) notFound()
```

to:

```js
  const { data: exam, error: examError } = await supabase
    .from('exams')
    .select(`
      id, title, status, duration_minutes, pass_mark,
      randomise_questions, randomise_options,
      show_calculator, tips, proctoring_enabled, access_code
    `)
    .eq('access_code', code.toUpperCase())
    .single()

  if (examError) {
    console.error('[LabAttemptPage]', examError)
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-sm text-text-muted">Failed to load your exam. Please refresh.</p>
      </div>
    )
  }

  if (!exam) notFound()

  const { data: attempt, error: attemptError } = await supabase
    .from('attempts')
    .select('id, exam_id, status, started_at, student_id')
    .eq('id', attemptId)
    .eq('student_id', user.id)
    .single()

  if (attemptError) {
    console.error('[LabAttemptPage]', attemptError)
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-sm text-text-muted">Failed to load your exam. Please refresh.</p>
      </div>
    )
  }

  if (!attempt) notFound()
```

- [ ] **Step 3: Hard-stop on `exam_questions`/`responses` failure**

Change (currently lines 54-79):

```js
  const { data: rawQuestions } = await supabase
    .from('exam_questions')
    .select(`
      id, question_id, order_index, marks,
      question_bank:question_id ( id, type, body, options, difficulty )
    `)
    .eq('exam_id', exam.id)
    .order('order_index')

  let questions = (rawQuestions ?? []).map(eq => ({
    id:          eq.id,
    question_id: eq.question_id,
    order_index: eq.order_index,
    marks:       eq.marks,
    ...eq.question_bank,
  }))

  if (exam.randomise_questions) {
    const seed = parseInt(attemptId.replace(/-/g, '').slice(0, 8), 16)
    questions = deterministicShuffle(questions, seed)
  }

  const { data: responses } = await supabase
    .from('responses')
    .select('question_id, student_answer')
    .eq('attempt_id', attemptId)

  return (
```

to:

```js
  const { data: rawQuestions, error: rawQuestionsError } = await supabase
    .from('exam_questions')
    .select(`
      id, question_id, order_index, marks,
      question_bank:question_id ( id, type, body, options, difficulty )
    `)
    .eq('exam_id', exam.id)
    .order('order_index')

  const { data: responses, error: responsesError } = await supabase
    .from('responses')
    .select('question_id, student_answer')
    .eq('attempt_id', attemptId)

  // Hard stop, no ExamInterface — rendering the interface with missing
  // questions or missing saved answers during a live, timed attempt is
  // worse than showing nothing (see plan design doc: correctness-critical
  // data, not a dashboard stat that can tolerate a temporary wrong zero).
  if (rawQuestionsError || responsesError) {
    console.error('[LabAttemptPage]', rawQuestionsError || responsesError)
    return (
      <div className="flex-1 flex items-center justify-center px-4 text-center">
        <p className="text-sm text-text-muted max-w-sm">
          Couldn't load your exam. Please refresh — your progress and timer are preserved.
        </p>
      </div>
    )
  }

  let questions = (rawQuestions ?? []).map(eq => ({
    id:          eq.id,
    question_id: eq.question_id,
    order_index: eq.order_index,
    marks:       eq.marks,
    ...eq.question_bank,
  }))

  if (exam.randomise_questions) {
    const seed = parseInt(attemptId.replace(/-/g, '').slice(0, 8), 16)
    questions = deterministicShuffle(questions, seed)
  }

  return (
```

- [ ] **Step 4: Lint**

Run: `npx eslint "app/lab/[code]/attempt/[attemptId]/loading.js" "app/lab/[code]/attempt/[attemptId]/page.js"`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Requires an in-progress attempt to reach this page (start an exam via the lobby first). Loading: 2s `setTimeout` right after `const { code, attemptId } = await params`, confirm skeleton, remove it. Primary error: break the `exam` query's `.select(...)`, reload, confirm the centered "Failed to load your exam" message. Revert. Hard-stop: break the `exam_questions` query's `.select(...)`, reload, confirm `ExamInterface` does NOT render — only the "Couldn't load your exam… progress and timer are preserved" message shows. Revert.

- [ ] **Step 6: Commit**

```bash
git add "app/lab/[code]/attempt/[attemptId]/loading.js" "app/lab/[code]/attempt/[attemptId]/page.js"
git commit -m "feat: add lab attempt loading skeleton and hard-stop on data failure"
```

---

### Task 16: Lab result — loading skeleton + hard-stop on score-data failure

**Files:**
- Create: `app/lab/[code]/result/loading.js`
- Modify: `app/lab/[code]/result/page.js`

- [ ] **Step 1: Create the loading skeleton**

```js
import { Skeleton } from '@/components/ui/Skeleton'

export default function LabResultLoading() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8 w-full">
      <Skeleton className="h-4 w-32 mb-6" />
      <div className="rounded-2xl border border-border p-8 mb-8 space-y-4">
        <Skeleton className="h-7 w-24 mx-auto" />
        <Skeleton className="h-14 w-40 mx-auto" />
        <Skeleton className="h-4 w-64 mx-auto" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Split the `examBasic` and `exam` queries' errors from "not found"**

In `app/lab/[code]/result/page.js`, change (currently lines 20-27):

```js
  const adminClient = createAdminClient()
  const { data: examBasic } = await adminClient
    .from('exams')
    .select('id')
    .eq('access_code', upperCode)
    .maybeSingle()

  if (!examBasic) notFound()
```

to:

```js
  const adminClient = createAdminClient()
  const { data: examBasic, error: examBasicError } = await adminClient
    .from('exams')
    .select('id')
    .eq('access_code', upperCode)
    .maybeSingle()

  if (examBasicError) {
    console.error('[LabResultPage]', examBasicError)
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-sm text-text-muted">Failed to load this exam. Please refresh.</p>
      </div>
    )
  }

  if (!examBasic) notFound()
```

Change (currently lines 55-61):

```js
  const { data: exam } = await supabase
    .from('exams')
    .select('id, title, pass_mark, duration_minutes, courses ( course_code )')
    .eq('id', examId)
    .single()

  if (!exam) notFound()
```

to:

```js
  const { data: exam, error: examError } = await supabase
    .from('exams')
    .select('id, title, pass_mark, duration_minutes, courses ( course_code )')
    .eq('id', examId)
    .single()

  if (examError) {
    console.error('[LabResultPage]', examError)
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-sm text-text-muted">Failed to load this exam. Please refresh.</p>
      </div>
    )
  }

  if (!exam) notFound()
```

- [ ] **Step 3: Hard-stop on anything feeding the score**

Change (currently lines 63-99):

```js
  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, status, submitted_at, total_score')
    .eq('exam_id', examId)
    .eq('student_id', user.id)
    .maybeSingle()

  // A submitted attempt normally has a result row by now (written in the
  // same request that marks it submitted) — this guards a rare edge case
  // (e.g. a transient DB error during submission) rather than a normal
  // expected state.
  const { data: result } = await supabase
    .from('results')
    .select('final_score, passed')
    .eq('exam_id', examId)
    .eq('student_id', user.id)
    .maybeSingle()

  const { data: examQuestions } = await supabase
    .from('exam_questions')
    .select('question_id, marks')
    .eq('exam_id', examId)

  const totalPossible = (examQuestions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)

  let responses = []
  if (result && attempt) {
    const { data: rawResponses } = await supabase
      .from('responses')
      .select(`
        question_id, student_answer, is_correct, marks_awarded, teacher_feedback,
        question_bank:question_id ( type, body, options, explanation )
      `)
      .eq('attempt_id', attempt.id)

    responses = rawResponses ?? []
  }
```

to:

```js
  const { data: attempt, error: attemptError } = await supabase
    .from('attempts')
    .select('id, status, submitted_at, total_score')
    .eq('exam_id', examId)
    .eq('student_id', user.id)
    .maybeSingle()
  if (attemptError) console.error('[LabResultPage]', attemptError)

  // A submitted attempt normally has a result row by now (written in the
  // same request that marks it submitted) — this guards a rare edge case
  // (e.g. a transient DB error during submission) rather than a normal
  // expected state.
  const { data: result, error: resultError } = await supabase
    .from('results')
    .select('final_score, passed')
    .eq('exam_id', examId)
    .eq('student_id', user.id)
    .maybeSingle()

  const { data: examQuestions, error: examQuestionsError } = await supabase
    .from('exam_questions')
    .select('question_id, marks')
    .eq('exam_id', examId)

  // Hard stop, never render a possibly-wrong score — the score card and
  // breakdown depend entirely on result/examQuestions being trustworthy
  // (see plan design doc: correctness-critical, not a dashboard stat).
  if (resultError || examQuestionsError) {
    console.error('[LabResultPage]', resultError || examQuestionsError)
    return (
      <div className="flex-1 flex items-center justify-center px-4 text-center">
        <p className="text-sm text-text-muted max-w-sm">
          Failed to load your result. Please refresh, or contact your exam officer if this persists.
        </p>
      </div>
    )
  }

  const totalPossible = (examQuestions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)

  let responses = []
  if (result && attempt) {
    const { data: rawResponses, error: responsesError } = await supabase
      .from('responses')
      .select(`
        question_id, student_answer, is_correct, marks_awarded, teacher_feedback,
        question_bank:question_id ( type, body, options, explanation )
      `)
      .eq('attempt_id', attempt.id)
    if (responsesError) console.error('[LabResultPage]', responsesError)

    responses = rawResponses ?? []
  }
```

- [ ] **Step 4: Lint**

Run: `npx eslint "app/lab/[code]/result/loading.js" "app/lab/[code]/result/page.js"`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Requires a submitted attempt with a result — complete an exam via the lobby/attempt flow first. Loading: 2s `setTimeout` right after `const { code } = await params`, confirm skeleton, remove it. Primary error: break the `exam` query's `.select(...)`, reload, confirm the centered "Failed to load this exam" message. Revert. Hard-stop: break the `results` query's `.select(...)`, reload, confirm no score card renders — only the "Failed to load your result…" message. Revert.

- [ ] **Step 6: Commit**

```bash
git add "app/lab/[code]/result/loading.js" "app/lab/[code]/result/page.js"
git commit -m "feat: add lab result loading skeleton and hard-stop on score-data failure"
```

---

### Task 17: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: no errors introduced by Tasks 1-16 (pre-existing unrelated errors in `useFormDraft.js`/camera components are baseline, not in scope).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds — catches any leftover temporary `setTimeout`/`nonexistent_column_xyz` debugging code from the manual verification steps across Tasks 4-16, plus any invalid `loading.js`/`error.js` export.

- [ ] **Step 3: Test suite**

Run: `npm test`
Expected: all existing tests still pass (171 as of the last full run) — regression guard, this plan adds no new tested logic.

- [ ] **Step 4: Click-through**

Run: `npm run dev`. Visit each of: `/admin/dashboard`, `/admin/courses`, `/admin/exams`, `/admin/logs`, `/admin/structure`, `/admin/users`, `/super-admin/dashboard`, `/super-admin/logs`, `/super-admin/universities`, `/super-admin/users`, `/lab` → enter a real code → lobby → start an exam → attempt → submit → result. Confirm no leftover skeletons, banners, or console errors.

This step has no commit — it's a final gate confirming Tasks 1-16 didn't leave any temporary debugging code behind.
