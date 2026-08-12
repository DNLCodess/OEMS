# Exam Interface Offline Resilience — Design

## Problem

`ExamInterface.js` (the student exam-taking screen) has no resilience to network loss or accidental reloads, and this is the highest-stakes place in the app for it to be missing — a student loses network mid-exam, or a shared kiosk machine gets bumped/reloaded, and their answers or place in the exam can vanish.

Concretely, three separate gaps:

1. **No local durability.** `currentIndex` and `flagged` are pure in-memory reducer state with no server equivalent — a reload always resets them to `0`/empty. `answers` is rebuilt from server-confirmed `responses` on reload, but anything typed within the last debounce/request-latency window that hasn't round-tripped to the server yet is silently lost.
2. **A real bug, not just a missing feature.** `handleAnswerChange`'s debounced `saveAnswer` call and `doSubmit`'s flush-and-submit both have zero error handling. A network failure mid-save is an unhandled promise rejection: `saveStatus` gets stuck on `'saving'` forever with no retry and no visible error — the student has no idea their answer never reached the server. A network failure mid-submit leaves the submit button spinning forever.
3. **No retry/offline-awareness at all** anywhere in the codebase — confirmed by a broad search, the only existing relevant piece is the `formDraftStorage.js` module built for the lecturer forms.

The kiosk delivery model (`/lab/{code}`, pre-loaded shared machines, per the exam-timing design) makes both network flakiness and incidental reloads more likely than a typical single-user form, raising the stakes further.

## Goal

A student who loses network briefly, or whose page reloads mid-exam, does not lose their place, their flags, or any answer they'd already typed — and gets a truthful, quiet indication of sync state instead of a spinner that lies by standing still forever.

## Design

### 1. Local persistence

Reuses `lib/hooks/formDraftStorage.js`'s pure functions (`readDraft`/`writeDraft`/`clearDraft`) directly — not the `useFormDraft` React hook, which is shaped around react-hook-form's `watch`/`reset`/`getValues` and doesn't fit this component's `useReducer` state. No new dependency.

- **Key:** `oems:exam:${attemptId}`. An attempt ID is already unique per (exam, student) — no additional scoping needed, unlike the lecturer forms which had to key by lecturer ID to avoid cross-user collision on a shared machine.
- **Persisted shape:** `{ answers, currentIndex, flagged: [...state.flagged] }` (a plain array — `Set` isn't JSON-serializable).
- **Write timing:** a `useEffect` watching `state` calls `writeDraft` on every change — not debounced. Local writes are cheap (small JSON blob, synchronous localStorage call); the debounce on the *server* save exists to limit network calls, which doesn't apply here. The whole point of this layer is zero-latency durability.
- **Restore on mount:** `buildInitialState` reads the local draft for this `attemptId`. `answers` merges as `{ ...serverAnswers, ...localDraft.answers }` — local wins, since it may hold edits newer than the last server-confirmed state. `currentIndex`/`flagged` restore directly from the local draft (no server equivalent to merge against). If no local draft exists (first load, or a different device), behavior is unchanged from today.
- **Deliberately NOT persisted or restored: `timeRemaining`.** It's always computed fresh from the server-authoritative `startedAt` + `exam.duration_minutes`, exactly as today. This is a hard constraint, not an oversight — the exam-timing design's whole premise is that the countdown is untrusted decoration and the server enforces the real deadline; letting a stale localStorage value seed the countdown would reintroduce exactly the kind of client-side-trust gap that design eliminated. `TICK` and the zero-reached auto-submit are untouched.
- **Clear:** `clearDraft(key)` is called only once `submitExam` returns success, immediately before the redirect to the results page. Never on unmount, tab close, or unload — that would defeat the purpose. An orphaned entry for an already-submitted attempt is harmless and left uncleaned (same no-expiry stance as the lecturer forms' design) — the attempt page won't even render `ExamInterface` for a non-`in_progress` attempt, so a stale key is simply never read again.

### 2. Save-failure handling (fixes the stuck-spinner bug)

`saveStatus` changes from one global `useState(null)` string to a per-question map: `useState({})`, shape `{ [questionId]: 'saving' | 'saved' | 'error' }`. A single global flag is actively misleading once retries exist — a retry can be for a question the student already navigated away from, and the old flat state would show that retry's status against whatever question happens to be on screen.

- `handleAnswerChange`'s debounced save wraps the `saveAnswer` call in try/catch. Success → `'saved'` for that `questionId`, clearing after 2s (same UX as today, now scoped per-question). A thrown error (network failure) → `'error'` for that `questionId`, and the question is added to a retry set.
- **Retry mechanism**, deliberately simple — no exponential backoff, no queue data structure beyond "which question IDs currently read `'error'`":
  - A `window.addEventListener('online', retryFailedSaves)` fires an immediate retry sweep the moment the browser regains connectivity — the fast path.
  - A `setInterval(retryFailedSaves, 5000)` runs whenever any question is in `'error'` state — the necessary fallback, since `navigator.onLine` only reflects the OS network interface, not real reachability (wifi connected, router/upstream down is a real and common case it misses).
  - `retryFailedSaves` re-invokes the same save call for every currently-`'error'` question, always using the latest value from `answersRef.current` (already existing pattern in the file) rather than a value captured at failure time — if the student kept typing while offline, the retry sends what's actually there now.
- `doSubmit`'s flush (`Promise.all` over every question's `saveAnswer`) and the `submitExam` call both get wrapped in try/catch. On failure: `setSubmitting(false)`, `submittingRef.current = false`, a toast ("Couldn't submit — check your connection and try again"), and the submit button becomes clickable again instead of spinning forever. localStorage is untouched on this path — nothing is lost, the student can just retry.

### 3. UI

- Top bar's existing "Saving…/Saved" indicator now reads `saveStatus[q.question_id]` for the *currently viewed* question instead of a flat value, and gains a third quiet state for `'error'`: small muted-tone text, "Will retry" — no spinner, no red alarm, no banner. Matches the "quiet indicator only" choice.
- `QuestionNav`'s per-question grid button gains a small corner dot (opposite corner from the existing flag bookmark icon, same visual weight) whenever `saveStatus[q.question_id] === 'error'` — a new `saveStatus` prop passed down. This is what lets a student see at a glance, without leaving the nav grid, which questions (including ones they've already navigated away from) still need to sync.

## Non-goals

- No offline-taking mode, no service worker, no ability to complete an exam with no network at all — the server must still be reachable to actually persist an answer or submit. This only makes brief blips and accidental reloads non-destructive, not extended offline use. Building genuine offline-taking would also raise exam-integrity questions (server-side timing/duration enforcement assumes it can observe activity) that are explicitly out of scope here.
- No change to server-side timing/integrity enforcement (`saveAnswer`'s overdue check, `submitExam`'s always-succeeds design, the lazy auto-submit-on-resume check) — all untouched.
- No change to proctoring, fullscreen enforcement, or violation-tracking logic.
- No draft expiry — same stance as the lecturer forms' design, for the same reason (simplicity; a stale entry is harmless given the attempt-status gate on rendering `ExamInterface` at all).
- Admin/school-admin form persistence (the second half of this session's "both, but sequenced" scope) is a separate design and plan, done after this one ships.
