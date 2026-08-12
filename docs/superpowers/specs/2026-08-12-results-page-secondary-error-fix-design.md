# Results Page Secondary-Error Degradation Fix — Design

## Problem

`app/lecturer/results/page.js` shows a `QueryErrorBanner` when its secondary queries (`attempts`, `results`) fail, but still renders the summary cards and every exam card using the `?? []` fallback — so "Total Submissions: 0" and "No submissions" appear on every card, indistinguishable from genuinely-zero data except for the banner text above. This was a deliberate "additive" call made in the original lecturer-portal state-handling plan, revisited now at the requester's judgment: showing confidently-wrong zeros next to a banner is worse than showing nothing.

## Goal

On a secondary-query failure, the page shows only data it actually has (exam identity: course, title, status, pass mark, total marks — all from the primary `exams` query, unaffected by this failure) and never shows submission/pass-rate figures it doesn't have.

## Design

In `app/lecturer/results/page.js`, guard three existing blocks with `!secondaryError` in addition to their current conditions:

1. **Summary cards** (`Total Submissions` / `Overall Pass Rate`, lines 113-121): wrap the whole `<div className="grid grid-cols-2 ...">` block in `{!secondaryError && (...)}`. The banner directly above already explains the absence.
2. **Per-exam header-right element** (`View Results` link vs. `No submissions` span, lines 139-149): change `exam.submitted > 0 ? (...) : (...)` to `secondaryError ? null : exam.submitted > 0 ? (...) : (...)` — no element renders when the submission count is unknown, rather than asserting "No submissions."
3. **Stats row and pass-rate bar** (lines 153 and 168): change `{exam.submitted > 0 && (...)}` to `{!secondaryError && exam.submitted > 0 && (...)}`, and `{exam.passRate !== null && (...)}` to `{!secondaryError && exam.passRate !== null && (...)}`.

No new files, no new components — `secondaryError` is already computed at line 66-67. This is a same-file edit.

## Non-goals

- No change to the primary-query (`exams`) error path — already correct (full-page banner, established in the original plan).
- No change to any other page — this fixes only the one deliberate trade-off called out for `results/page.js`.
