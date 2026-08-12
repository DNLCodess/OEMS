# Results Page Secondary-Error Degradation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `app/lecturer/results/page.js` from showing confidently-wrong zero/"No submissions" figures when its secondary queries (`attempts`, `results`) fail — those figures should disappear entirely, not render alongside the existing failure banner.

**Architecture:** Same-file conditional-rendering change. No new components, no new files. `secondaryError` is already computed in the page (line 66-67 as of this plan).

**Tech Stack:** Next.js App Router Server Component, Tailwind CSS.

## Global Constraints

- Single file: `app/lecturer/results/page.js`. No other pages touched.
- No new npm dependencies.
- Preserve the existing primary-query (`exams`) error path untouched — only the secondary-query degradation changes.

---

### Task 1: Suppress unknown figures on secondary-query failure

**Files:**
- Modify: `app/lecturer/results/page.js`

**Interfaces:** None — self-contained page-level change, no exports affected.

- [ ] **Step 1: Guard the summary cards block**

Change (currently lines 113-121):

```js
      {/* Platform summary */}
      <div className="grid grid-cols-2 gap-4 mb-6 max-w-md">
        <SummaryCard label="Total Submissions" value={totalSubmissions} color="neutral" />
        <SummaryCard
          label="Overall Pass Rate"
          value={overallPassRate !== null ? `${overallPassRate}%` : '—'}
          color={overallPassRate !== null ? (overallPassRate >= 60 ? 'success' : 'danger') : 'neutral'}
        />
      </div>
```

to:

```js
      {/* Platform summary */}
      {!secondaryError && (
        <div className="grid grid-cols-2 gap-4 mb-6 max-w-md">
          <SummaryCard label="Total Submissions" value={totalSubmissions} color="neutral" />
          <SummaryCard
            label="Overall Pass Rate"
            value={overallPassRate !== null ? `${overallPassRate}%` : '—'}
            color={overallPassRate !== null ? (overallPassRate >= 60 ? 'success' : 'danger') : 'neutral'}
          />
        </div>
      )}
```

- [ ] **Step 2: Guard the per-exam header-right element**

Change (currently lines 139-149):

```js
              {exam.submitted > 0 ? (
                <Link
                  href={`/lecturer/exams/${exam.id}/results`}
                  className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors"
                >
                  <Users size={14} />
                  View Results
                </Link>
              ) : (
                <span className="shrink-0 text-sm text-text-muted">No submissions</span>
              )}
```

to:

```js
              {secondaryError ? null : exam.submitted > 0 ? (
                <Link
                  href={`/lecturer/exams/${exam.id}/results`}
                  className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors"
                >
                  <Users size={14} />
                  View Results
                </Link>
              ) : (
                <span className="shrink-0 text-sm text-text-muted">No submissions</span>
              )}
```

- [ ] **Step 3: Guard the stats row and pass-rate bar**

Change (currently line 153):

```js
            {exam.submitted > 0 && (
```

to:

```js
            {!secondaryError && exam.submitted > 0 && (
```

Change (currently line 168):

```js
            {exam.passRate !== null && (
```

to:

```js
            {!secondaryError && exam.passRate !== null && (
```

- [ ] **Step 4: Lint**

Run: `npx eslint app/lecturer/results/page.js`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Temporarily change the `attempts` query's `.select(...)` (in the `Promise.all`) to `.select('nonexistent_column_xyz')`. Reload `/lecturer/results` — the "Some result data failed to load…" banner should appear, no summary cards below it, and every exam card should show only its identity info (course code, title, badge, pass mark, total marks) with no "View Results"/"No submissions" label, no stats row, no pass-rate bar. Revert the `.select(...)`.

- [ ] **Step 6: Commit**

```bash
git add app/lecturer/results/page.js
git commit -m "fix: hide unknown submission figures on results page query failure"
```

---

### Task 2: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: no errors introduced (pre-existing unrelated errors in `useFormDraft.js`/camera components are baseline and not in scope).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds — also catches any leftover temporary `nonexistent_column_xyz` debugging code from Task 1 Step 5.

- [ ] **Step 3: Test suite**

Run: `npm test`
Expected: all existing tests still pass (171 as of this plan) — this change touches no tested logic, so this is a regression guard, not new coverage.

This step has no commit — it's a final gate.
