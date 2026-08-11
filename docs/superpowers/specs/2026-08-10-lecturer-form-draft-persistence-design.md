# Lecturer Form Draft Persistence — Design

## Problem

Lecturer dashboard forms (question creation, exam settings) have no protection against data loss on refresh or lost network. `QuestionForm.js` (rich text body/explanation, dynamic answer options) and `ExamSettingsForm.js` (13+ fields incl. a dynamic tips array) are the two real data-entry forms under `app/lecturer/**`. Losing a half-written question or exam config to an accidental refresh or a dropped connection is a real, recurring frustration, and there's currently no `localStorage`/`sessionStorage` usage anywhere in the repo to build on.

This is the first of several planned localStorage/offline UX improvements; other dashboards (student, admin) will follow in later passes. This pass is scoped to the lecturer dashboard's two forms only.

## Goal

A lecturer who is mid-way through creating or editing a question or exam, and loses network or accidentally refreshes, gets their in-progress field values back automatically — no re-typing from scratch.

## Design

### 1. Shared hook: `lib/hooks/useFormDraft.js`

A new `lib/hooks/` directory (none exists today) holding one hook that wraps a react-hook-form instance:

```js
useFormDraft(key, form, { enabled = true } = {})
// returns { restored, clearDraft, dismissRestored }
```

- **Restore (on mount):** read `localStorage[key]`. If present and parses cleanly, call `form.reset(draft)` and set `restored = true`. If parsing fails (corrupted or stale-shape data), silently delete the key and continue with the form's normal `defaultValues` — never throw, never block the form from rendering.
- **Persist (on change):** subscribe via `form.watch()`, debounce writes 500ms, `JSON.stringify(values)` into `localStorage[key]`. All current field values across both forms (rich-text HTML strings from Tiptap, option/tips arrays, plain strings/numbers/booleans) are plain JSON — no custom serialization needed.
- **Clear:** exposed as `clearDraft()`. Called by each form after a successful submit, and by the "Discard draft" banner action.
- Every `localStorage` read/write wrapped in try/catch. If storage is unavailable (private browsing, quota exceeded), the hook degrades to a no-op — drafts just don't persist, forms work exactly as they do today.
- Guarded with `typeof window !== 'undefined'` since these are client components but the guard costs nothing and protects against edge cases.

No new dependencies — native `localStorage` plus a small inline debounce.

### 2. Storage key: scoped per-lecturer, per-form, per-entity

```
oems:draft:<lecturerId>:<question|exam>:<questionId|examId|'new'>
```

`lecturerId` comes from `requireRole('lecturer')` in the server page component (already fetched there) and is threaded down as a new prop to `QuestionForm`/`ExamSettingsForm`. This prevents one lecturer's unsaved draft from surfacing for a different lecturer on a shared lab/office computer. Keying by entity id (not just "question"/"exam") means an edit-form draft never bleeds into a different question/exam, and create vs. edit never collide.

Four page files get the one-line prop addition: `app/lecturer/questions/new/page.js`, `app/lecturer/questions/[id]/edit/page.js`, `app/lecturer/exams/new/page.js`, `app/lecturer/exams/[id]/edit/page.js`.

### 3. Wiring into the two forms

In each form, one call right after the existing `useForm(...)`:

```js
const { restored, clearDraft, dismissRestored } = useFormDraft(
  `oems:draft:${lecturerId}:question:${question?.id ?? 'new'}`,
  { watch, reset, ...formMethods }
)
```

- `QuestionForm.js`: added after the existing `useForm` call (currently line 75).
- `ExamSettingsForm.js`: added after the existing `useForm` call (currently line 61).

In both `onSubmit` handlers, call `clearDraft()` right after the existing success branch (`toast.success(...)`), before the `router.push`/`router.refresh()`.

### 4. Restore UX: silent auto-fill + small banner

When `restored` is true, render a small dismissible banner at the top of the form body:

> Draft restored from your last session. **Discard draft**

Styled consistently with the existing `bg-primary-light` info banner already used in `ExamSettingsForm.js`'s Delivery section. "Discard draft" calls `clearDraft()` and `form.reset(buildDefaults(question))` (or the edit form's equivalent original defaults) to drop back to the server-loaded/blank state. The banner itself dismisses via `dismissRestored()` without discarding the draft — it just stops persisting the "restored" flag in local state, the draft keeps autosaving as normal.

### 5. Testing

Unit tests for `useFormDraft` in `tests/` (matching the existing `vitest` setup): restore-on-mount with valid data, debounce-then-save on change, corrupted-JSON falls back cleanly, `clearDraft` removes the key, and `enabled: false` is a full no-op. `localStorage` mocked per existing test conventions.

## Non-goals

- No draft *expiry* — drafts persist until submitted or manually discarded (explicit product decision: simplicity over stale-data cleanup for this pass).
- No conflict detection against server data that changed elsewhere since the draft was saved (e.g. another lecturer edited the same exam) — accepted risk for this pass.
- No coverage of `QuestionPickerModal.js`, `ExamAccessPanel.js`'s search field, or `QuestionsFilters.js` — none hold data worth persisting (transient search / already URL-persisted).
- No student or admin dashboard forms — later, separate passes.
