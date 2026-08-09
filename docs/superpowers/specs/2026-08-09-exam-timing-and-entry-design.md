# Exam Timing and Entry Redesign — Design

## Problem

Tracing the actual exam-day flow surfaced two related flaws, both stemming from the same root cause: every time-sensitive rule in the system today is enforced by a human clicking a button or by client-side JavaScript, never by the server.

1. **Operational fragility.** Going live and closing an exam are both single-human-click actions (`WorkflowPanel.js` → `updateExamStatus`). `exams.start_at`/`end_at` exist but are never read by `verifyExamAccess` or `startExam` — purely decorative today. Nothing stops an exam from going live late, staying open indefinitely, or (in principle) anyone with the button access flipping it early.
2. **Exploitable integrity gap.** Each attempt's `started_at` is a real server timestamp (solid), but the countdown and auto-submit (`ExamInterface.js`) are 100% client-side `setInterval` JavaScript. Neither `saveAnswer` nor `submitExam` ever check elapsed time. A student who disables the client-side timer (trivial via devtools) can keep saving answers indefinitely past their allotted `duration_minutes`, as long as the exam is still `live`.

Both are fixed together, because the fix for one shapes the fix for the other: authority over timing moves from "a human/browser said so" to "the server can prove it."

## Goal

- The lecturer keeps a deliberate, manual "Go Live" trigger — not a pre-scheduled wall-clock time — because a fixed `start_at` becomes stale the moment a room isn't actually ready (projector down, students still filing in). This is a real safety valve, not something to automate away.
- Once live, new entries are gated by a *duration since go-live*, not a fixed end time — so the entry window survives a late start correctly.
- Every student's own answering time is capped by the server, not just the browser.

## Design

### 1. Two new exam-level fields

- `go_live_at` — nullable timestamp. **Never lecturer-editable.** Stamped by the server the instant `updateExamStatus` transitions an exam to `live`.
- `entry_window_minutes` — lecturer-configured at exam-creation time, same shape and validation pattern as the existing `duration_minutes` (numeric, min/max bounded). Default **10 minutes**. How long after go-live new students may still start an attempt — not how long the exam stays open overall.

### 2. Entry is gated by two independent, additive checks

`verifyExamAccess` and `startExam` already check `exam.status === 'live'`. That check is unchanged. A second, independent check is added: `now <= go_live_at + entry_window_minutes`. Both must pass for a *new* attempt to start.

Crucially, this window governs only new entries. A student already mid-attempt is completely unaffected by the entry window closing — they're governed entirely by their own `attempts.started_at + exams.duration_minutes`, checked independently (see §3). This is what makes "Close Exam" safe to leave fully manual: there's no automatic status transition to design or get wrong. The lecturer closes the exam whenever they judge the sitting genuinely done (all students finished, or they're intervening for some other reason) — a deliberate, low-frequency decision, not a time-pressured one, since the entry window has already done the job of stopping new latecomers automatically.

### 3. Server-side per-student duration enforcement

- `saveAnswer`: reject once `now > attempts.started_at + exams.duration_minutes + 60s`. The 60-second grace absorbs ordinary network latency on the final save right at the deadline — it is not lecturer-configurable, it's an implementation constant. Rejection returns a distinct error the client recognizes (see §5), not the generic "failed to save" message.
- `submitExam`: **never time-blocked.** It's the only way out of the time-over state, so it must always succeed regardless of how late it's called.
- **Lazy auto-submit for abandoned attempts.** A student who closes the tab and never calls `submitExam` again would otherwise leave a permanently stuck `in_progress` attempt with no result. Fix: the existing "resume an in-progress attempt" check (in the lobby / `startExam`'s existing-attempt branch) gains a lazy check — if the found attempt is `in_progress` and past `started_at + duration_minutes`, submit it immediately (server-side, same grading path as a normal `submitExam` call) before returning anything to the client. This needs no cron/background job — the system is small enough that "check and fix on next read" is the right-sized mechanism, not premature infrastructure.

### 4. Entry UX: `/lab/{code}` becomes dual-mode

Today, reaching `/lab/{code}` requires an already-authenticated session (from a separate matric+code form). That's what actually blocks "just pre-load this URL on every lab machine" — an unauthenticated visitor gets bounced to `/login`.

Redesign: `/lab/{code}` checks for an existing valid session bound to this exam first.
- **No session yet:** render a matric-number-only form. The access code is already implicit in the URL (route param), passed as a hidden field alongside the typed matric number to the existing `verifyExamAccess` action — no change to that action's signature or logic, only to what UI feeds it. On success, same page transitions to the lobby view.
- **Session already exists for this exam:** render the existing lobby / "Begin Exam" view unchanged.

This is what makes lab setup "load one URL on every machine, done" — no per-student code entry, no separate generic entry page needed for the normal lab case. The existing generic two-field (matric + code) entry page is **kept, not replaced** — it remains the fallback for a student without a pre-loaded machine, and keeps the door open for remote-mode reactivation later (hidden, not deleted, per earlier tonight's work) since remote students have no pre-loaded lab machine to rely on.

### 5. Client-side handling of a server-rejected save

`ExamInterface.js`'s autosave currently treats a `saveAnswer` failure as a generic error toast. When the server rejects specifically because time is up (a distinct error shape, not a generic failure), the client should stop attempting further saves and immediately trigger the same submit flow the local countdown already uses at zero — so a student whose local clock has drifted or whose timer was tampered with still gets funneled to a normal submit rather than a confusing wall of failed-save toasts.

### 6. `start_at`/`end_at` removed

Dropped from `ExamSettingsForm.js` and `lib/validations/exams.js` entirely — they enforce nothing today, and a non-functional "Start Date & Time" field actively misleads a lecturer into thinking it controls something it doesn't. The `exams.start_at`/`end_at` columns themselves are left in the schema, unused (same "leave the column, stop the app from writing to it" pattern as tonight's earlier `exam_mode` hide) — not a migration, just an app-layer change.

## Non-goals

- No change to `exam_mode`/lab-vs-remote (already handled tonight).
- No cron/scheduled-job infrastructure — the lazy-check pattern in §3 is deliberately the smallest mechanism that closes the gap, not a general background-job system.
- No change to the RLS/access-control-fix work from earlier tonight (exam-specific session binding, the allow-list) — this design composes with it, doesn't touch it.

## Testing

- `lib/actions/attempts.test.js`: new tests for `saveAnswer`'s time-cutoff rejection (just past the grace period), `submitExam` still succeeding when called late, and the lazy auto-submit path triggering from the resume check.
- `lib/actions/studentAuth.test.js` / `lib/actions/exams.test.js`: new tests for the entry-window check (`verifyExamAccess` rejecting after `go_live_at + entry_window_minutes`, `updateExamStatus` stamping `go_live_at` on the `live` transition).
- Migration: one new file adding `go_live_at` and `entry_window_minutes` to `exams`, applied the same way as every other migration this session (written, then applied directly against the live project via the Supabase MCP tools now available, rather than asking the user to run it by hand).
