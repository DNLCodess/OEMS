# Lecturer Portal Loading/Error/Pending State Handling — Design

## Problem

The lecturer portal (`app/lecturer/**`) has no `loading.js` anywhere, so every route shows a blank page until its Server Component fully resolves — worse on pages that run multiple parallel Supabase queries (dashboard, exam detail).

Error handling on initial page load is inconsistent. `app/lecturer/questions/page.js` destructures `{ data, error }`, logs the error, and renders a red banner on failure. Every other lecturer page (`dashboard`, `exams`, `exams/[id]`, `results`) discards `error` and falls back to `?? []`/`?? 0` — a real Supabase failure renders identically to "no data yet," with no signal to the lecturer that anything went wrong. There is also no `error.js` boundary anywhere in the app, so a thrown exception falls through to Next's default unstyled error page.

Pending states on mutations are already solid and are **not** part of this problem: every client component that calls a Server Action (`WorkflowPanel`, `ExamAccessPanel`, `ArchiveButton`, `ExamBuilder`, `AccessCodePanel`, `QuestionPickerModal`, `QuestionForm`, `ExamSettingsForm`) already disables its trigger and shows "Saving…"/"Updating…"/"Archiving…" via `useTransition` or a manual `useState` flag, and every Server Action in `lib/actions/exams.js`/`lib/actions/questions.js` returns a consistent `{ error: string }` shape surfaced via `toast.error(...)`.

## Goal

A lecturer who hits a slow query sees a skeleton that matches the page they're waiting for, not a blank screen. A lecturer who hits a failed query sees an explicit "failed to load" signal, not a page that quietly looks empty. Both apply consistently across every page under `app/lecturer/**`.

## Scope

Lecturer portal only (`app/lecturer/**`). Admin, super-admin, and student dashboards are out of scope for this pass — this repo's convention (see the lecturer form-draft-persistence spec) is to land a pattern on one role first and roll it out to others later.

## Design

### 1. Shared skeleton primitive: `components/ui/Skeleton.js`

A single building block:

```js
Skeleton({ className })
// <div className={`animate-pulse bg-slate-100 rounded ${className}`} />
```

Every `loading.js` below composes its layout from this one primitive instead of repeating pulse styling.

### 2. Per-route `loading.js` files, layout-matching

Next.js automatically wraps a segment's `page.js` in `<Suspense>` when a sibling `loading.js` exists — no manual `<Suspense>` wiring needed. Each new file mirrors its page's real structure (same grid/columns) so nothing jumps when real content swaps in:

| File | Mirrors |
|---|---|
| `app/lecturer/dashboard/loading.js` | 4 stat cards, exam pipeline grid, exam performance list, right-column panels |
| `app/lecturer/exams/loading.js` | Header + status tabs + exam card grid |
| `app/lecturer/exams/[id]/loading.js` | Header + question builder + 3 sidebar panels |
| `app/lecturer/exams/[id]/results/loading.js` | Summary stats + results table layout |
| `app/lecturer/questions/loading.js` | Filter bar + question card grid |
| `app/lecturer/results/loading.js` | Summary cards + exam result cards |

Not added: `exams/new`, `questions/new`, `exams/[id]/edit`, `questions/[id]/edit`, `exams/[id]/preview` — these have no meaningful data-fetch delay before render (new forms fetch nothing; edit/preview do one fast single-record query), so a skeleton would flash for a few ms and add noise rather than value.

### 3. Shared error boundary: `app/lecturer/error.js`

One client component (Next.js requires `error.js` boundaries to be client components) at the layout level, catching any thrown exception from a page or its children anywhere under `app/lecturer/**`. Renders a branded card: "Something went wrong," a **Try again** button calling the `reset()` prop Next.js passes in (re-renders the segment without a full navigation), and a link back to `/lecturer/dashboard`. Logs via `console.error`, matching the existing `console.error('[QuestionsPage]', error)` convention — no error-tracking service is wired up in this repo, so that's as far as this pass goes.

### 4. The query-error rule

Applied consistently across `dashboard/page.js`, `exams/page.js`, `exams/[id]/page.js`, `questions/page.js`, `results/page.js`:

- **Primary query** — the query whose data the page exists to show (dashboard's `myExams`, `exams/page.js`'s exam list, `exams/[id]/page.js`'s single `exam`, `results/page.js`'s `exams`, `questions/page.js`'s `questions` — already handled correctly there). On `error`, `throw new Error(...)` so `error.js` catches it.
  - `exams/[id]/page.js` special case: the existing line `if (!exam || exam.created_by !== user.id) notFound()` currently conflates "query failed" with "no such row" — both funnel into a 404. This gets split: a real `error` throws (→ `error.js`), while `!exam` with no `error` (or a "no rows" result) still calls `notFound()` (→ proper 404).
- **Secondary/enrichment query** — decorates the page but isn't the reason it exists (dashboard's `results` query; exam detail's `exam_questions`/`bankQuestions`/`examAccess`; questions page's `courses` filter list). On `error`, degrade gracefully: keep the `?? []` fallback so the page still renders, but also render the inline red banner pattern already established in `questions/page.js` ("Failed to load X. Please refresh.") instead of failing silently.

### Testing

No new unit tests planned — these are Next.js file-convention boundaries (`loading.js`/`error.js`) and presentational skeleton markup, consistent with how the rest of `app/lecturer/**`'s page-level UI is untested today. The query-error-rule changes to each page are straightforward branch additions (`if (error) throw ...` / `if (error) <banner>`) reviewed by hand rather than covered by new test files.

## Non-goals

- No changes to mutation pending/error handling — already solid (see Problem section).
- No error-tracking/Sentry integration — `console.error` only, matching existing convention.
- No changes to admin, super-admin, or student dashboards — later, separate passes.
- No retry/backoff logic beyond the `error.js` "Try again" button.
