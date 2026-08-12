# Admin, Super-Admin, and Lab (Student) Loading/Error State Handling — Design

## Problem

The lecturer portal (`app/lecturer/**`) now has loading skeletons, a shared `error.js` boundary, and consistent query-error banners (see `2026-08-12-lecturer-portal-state-handling-design.md`). Admin (`app/admin/**`), super-admin (`app/super-admin/**`), and the student exam-taking flow (`app/lab/**`) still have the original problem: no `loading.js` anywhere, no `error.js` boundary, and Supabase query errors mostly discarded and defaulted to `?? []`/`?? 0`, indistinguishable from genuinely-empty data.

Admin and super-admin are structurally identical to lecturer — same `Sidebar`-wrapped layout (`components/shared/Sidebar.js`), same `TopBar`, same query patterns — so the existing `Skeleton`/`QueryErrorBanner`/`error.js` pattern applies directly, no new decisions needed.

The lab flow is different in kind, not just shape. Lecturer/admin/super-admin pages show *aggregate stats* — a wrong zero is a temporary, low-stakes annoyance until refresh. Lab pages show *individually consequential, correctness-critical data*: the actual questions during a live, timed (sometimes proctored) exam attempt, and a final score. A degraded/partial view there isn't a lesser inconvenience — it's a fairness and integrity problem (a student answering a silently-truncated exam, or seeing a wrong score). This requires a stricter rule than the banner-in-place-of-content pattern used elsewhere.

## Goal

Admin and super-admin get the exact same loading/error treatment lecturer already has. The lab flow gets an adapted version: loading skeletons and a kiosk-styled `error.js` boundary, but any query failure touching exam-question or score integrity hard-stops that view (no partial/degraded render) rather than showing a banner alongside content that might be wrong.

## Design

### 1. Admin and super-admin: direct reuse, no new components

Both portals reuse `components/ui/Skeleton.js` and `components/ui/QueryErrorBanner.js` as-is. Each gets:
- One `loading.js` per route with a meaningful query (skipped where there's no query — `app/super-admin/settings/page.js` reads only `process.env`, no Supabase call, so no `loading.js`/error-handling changes there).
- One `error.js` at the portal root (`app/admin/error.js`, `app/super-admin/error.js`) — identical to `app/lecturer/error.js` except the "Back to dashboard" link target (`/admin/dashboard`, `/super-admin/dashboard` respectively). Can't be a single shared file since each is a separate top-level route segment under `app/`.

**Query-error rule (refined from the lecturer version):** a query gets its content replaced by `QueryErrorBanner` on failure only when that failure would otherwise render as *misleading data* — a stat, count, or list that looks complete/accurate but isn't. A query whose only consumer is an optional dropdown in a not-yet-open modal or form (e.g. the `faculties`/`departments` lists feeding `InviteUserModal`, `BulkUploadStudentsModal`, `CreateCourseForm`'s department picker) is logged via `console.error` but given no dedicated banner — its failure mode is "the dropdown is empty," not "a false zero looks real," which isn't the problem the banner exists to solve.

Per-page breakdown:

| Page | Primary (banners on error) | Secondary — bannered (misleading-data risk) | Secondary — logged only (modal/dropdown data) |
|---|---|---|---|
| `admin/dashboard/page.js` | Combined: any of the ~9 `Promise.all` queries + follow-ups failing replaces the whole stats/pipeline/department/health grid below the top 4 stat cards (same shape as the lecturer dashboard fix) | — | — |
| `admin/courses/page.js` | `courses` (table) | — | `departments` (feeds `CreateCourseForm` dropdown only) |
| `admin/exams/page.js` | `exams` (table) | `attemptCounts` (submissions column — currently defaults to `0`, changes to `—` plus a banner on failure, since `0` reads as real data) | — |
| `admin/logs/page.js` | `logs` (table) | — | — |
| `admin/structure/page.js` | `faculties` + `departments` combined (drives the "Current Structure" tree) | — | (also feeds `CreateDepartmentForm`'s faculty dropdown — accepted minor degradation, no separate banner) |
| `admin/users/page.js` | `users` (the three role-grouped tables) | — | `faculties`, `departments` (feed `InviteUserModal`/`BulkUploadStudentsModal` dropdowns only) |
| `super-admin/dashboard/page.js` | Combined: any of the ~7 queries + follow-ups failing replaces the university-cards/health/latest-exams grid below the top 4 stat cards | — | — |
| `super-admin/logs/page.js` | `logs` (table) | — | — |
| `super-admin/universities/page.js` | `universities` (cards) | `userCounts` (per-university student/lecturer/total figures — same "false zero" risk as `admin/exams`'s `attemptCounts`) | — |
| `super-admin/users/page.js` | `users` (table) | — | — |

### 2. Lab flow: adapted loading, kiosk-styled error boundary

- `app/lab/error.js` — one boundary for the whole flow. Styled `flex-1 flex items-center justify-center` to match `LabLayout`'s `min-h-screen bg-page flex flex-col` shell (no sidebar, unlike the other three portals' `error.js`) — same "Try again"/`reset()` button, no "back to dashboard" link (nothing to go back to in a kiosk session; omitted rather than pointed at `/lab` since a mid-exam student shouldn't be nudged to abandon their attempt).
- `loading.js` for `app/lab/[code]/`, `app/lab/[code]/attempt/[attemptId]/`, and `app/lab/[code]/result/` — each has a real query chain. Skipped only for `app/lab/page.js`, the code-entry screen, which is a static form with no query.

**Query-error rule for lab (replaces the banner rule — hard-stop instead):**

| Page | Query | On error |
|---|---|---|
| `lab/[code]/page.js` (lobby) | `exam` (post-auth) | Full-screen centered message: "Failed to load this exam. Please refresh." — no lobby content renders (mirrors the existing `notFound()`/auth-gate early-return style already in this file). |
| | `exam_questions` (duration/question-count stats only) | Hide the 3-stat row (duration/questions/marks) rather than show `0`/`0`/`0` — the CTA to start the exam still renders, since starting doesn't depend on this display data. |
| | `attempt` (existing-in-progress-attempt check, used only to redirect straight into a resumed attempt) | Logged only, no UI change — a failure here just means the "Start Exam" CTA shows instead of an automatic redirect; `startExam` (`lib/actions/attempts.js:49`) independently re-checks for an in-progress attempt and resumes it rather than creating a duplicate, so this has no correctness impact, only a minor extra click. |
| `lab/[code]/attempt/[attemptId]/page.js` | `exam`, `attempt` | Existing `notFound()` split into error-vs-missing, same pattern as `lecturer/exams/[id]/page.js`: a real error shows a centered "Failed to load your exam. Please refresh." message; a genuinely missing row still 404s. |
| | `exam_questions`, `responses` | **Hard stop** — do not render `ExamInterface`. Centered message: "Couldn't load your exam. Please refresh — your progress and timer are preserved." (Confirmed safe: `ExamInterface`'s timer is computed from `attempt.started_at`, a server timestamp — `components/student/ExamInterface.js:27` — not client state, so a refresh costs no time and loses no saved answers.) |
| `lab/[code]/result/page.js` | `exam`, `attempt` | Same error-vs-missing `notFound()` split as above. |
| | `result`, `examQuestions` (anything feeding the displayed score/percentage) | **Hard stop** — never render a score. Centered message: "Failed to load your result. Please refresh, or contact your exam officer if this persists." replaces the score card and question breakdown entirely. |
| | `responses` alone (question-breakdown detail, not the score itself) | Degrade gracefully — the existing `{responses.length > 0 && (...)}` guard already handles an empty array; a failure just means no breakdown shows, which is the same visual outcome as "no responses yet" and carries no correctness risk since the score card doesn't depend on it. |

No new shared components for the lab flow — the centered-message blocks above are small enough to write inline per call site (they're each already inside an existing conditional-early-return in these files, just like the current `notFound()`/auth-gate blocks), following the file's existing style rather than introducing a component used in only 5 places with 5 different messages.

### Testing

Same as the lecturer plan: no automated tests (no React-rendering test setup in this repo). Verification is lint + `npm run build` + `npm test` (regression guard) + manual dev-server checks per page, following the same temporary-`setTimeout`-for-loading / temporary-bad-`.select()`-for-error technique used in the lecturer plan.

## Non-goals

- No changes to `app/super-admin/settings/page.js` — no Supabase query exists there.
- No changes to error-tracking/alerting or automated test infrastructure — separate sub-projects, not started yet.
- No new shared components beyond what's reused from the lecturer pass (`Skeleton`, `QueryErrorBanner`).
- No changes to `app/lab/LabCodeEntry.js`, `MatricEntryForm.js`, `LabStartButton.js`, `EndSessionButton.js`, or `ExamInterface.js` — these are client components handling their own mutation pending/error state already (out of scope, same reasoning as the lecturer plan's mutation-handling non-goal).
