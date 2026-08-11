# Lecturer Form Draft Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lecturers no longer lose in-progress work in `QuestionForm.js` or `ExamSettingsForm.js` to a refresh or dropped connection — field values are auto-saved to `localStorage` and restored on reload.

**Architecture:** A pure, framework-free storage module (`lib/hooks/formDraftStorage.js`) handles all `localStorage` reads/writes/debouncing and is unit-testable in this repo's Node test environment. A thin React hook (`lib/hooks/useFormDraft.js`) wraps it around a react-hook-form instance (restore-on-mount via `reset`, debounced-save via `watch`, `clearDraft` on submit). Both `QuestionForm.js` and `ExamSettingsForm.js` call the hook once each; a small shared `DraftBanner.js` component surfaces the "draft restored" notice.

**Tech Stack:** Next.js (App Router), react-hook-form + zodResolver, native `localStorage` (no new dependencies), vitest (existing `environment: 'node'` config).

## Global Constraints

- No new npm dependencies — this repo has no `jsdom`/`@testing-library/react`, so the React hook itself is verified manually in-browser, not unit-tested; only the extracted pure storage/debounce logic gets vitest coverage (Node-environment-safe).
- Storage key format: `oems:draft:<lecturerId>:<question|exam>:<entityId|'new'>`.
- Debounce delay for autosave writes: 500ms (constant, not configurable).
- No draft expiry — persists until explicit submit-success or manual "Discard draft".
- Draft restore merges over current form defaults (`{ ...getValues(), ...draft }`) rather than a raw `reset(draft)`, so a field missing from an older/corrupted draft never leaves a form field `undefined`.
- Scope: only `QuestionForm.js` and `ExamSettingsForm.js` (and the 4 lecturer page files that render them). No other dashboards, no other forms.

---

### Task 1: Pure draft-storage module

**Files:**
- Create: `lib/hooks/formDraftStorage.js`
- Test: `tests/hooks/formDraftStorage.test.js`

**Interfaces:**
- Produces: `readDraft(key: string): object | null`, `writeDraft(key: string, values: object): void`, `clearDraft(key: string): void`, `debounce(fn: Function, delayMs: number): Function & { cancel: () => void }` — all named exports from `lib/hooks/formDraftStorage.js`, consumed by Task 2's hook.

- [ ] **Step 1: Write the failing tests**

Create `tests/hooks/formDraftStorage.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readDraft, writeDraft, clearDraft, debounce } from '@/lib/hooks/formDraftStorage'

function createMockStorage() {
  const store = new Map()
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
}

describe('formDraftStorage', () => {
  let storage

  beforeEach(() => {
    storage = createMockStorage()
    vi.stubGlobal('localStorage', storage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writeDraft then readDraft round-trips values', () => {
    writeDraft('k1', { title: 'hello', count: 3 })
    expect(readDraft('k1')).toEqual({ title: 'hello', count: 3 })
  })

  it('readDraft returns null when nothing stored', () => {
    expect(readDraft('missing')).toBeNull()
  })

  it('readDraft returns null and clears the key when JSON is corrupted', () => {
    storage.setItem('bad', '{not valid json')
    expect(readDraft('bad')).toBeNull()
    expect(storage.getItem('bad')).toBeNull()
  })

  it('clearDraft removes the stored key', () => {
    writeDraft('k2', { a: 1 })
    clearDraft('k2')
    expect(readDraft('k2')).toBeNull()
  })

  it('writeDraft degrades silently when storage throws (e.g. quota exceeded)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('quota exceeded') },
      removeItem: () => {},
    })
    expect(() => writeDraft('k3', { a: 1 })).not.toThrow()
  })

  it('readDraft returns null when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(readDraft('k4')).toBeNull()
  })
})

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('only invokes fn once, after the delay, with the last call\'s args', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 500)
    debounced('a')
    debounced('b')
    debounced('c')
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('c')
  })

  it('cancel() prevents a pending invocation', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 500)
    debounced('a')
    debounced.cancel()
    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hooks/formDraftStorage.test.js`
Expected: FAIL — `Failed to resolve import "@/lib/hooks/formDraftStorage"`.

- [ ] **Step 3: Write the implementation**

Create `lib/hooks/formDraftStorage.js`:

```js
function getStorage() {
  return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
}

export function readDraft(key) {
  const storage = getStorage()
  if (!storage) return null

  let raw
  try {
    raw = storage.getItem(key)
  } catch {
    return null
  }
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    try {
      storage.removeItem(key)
    } catch {
      // storage unavailable — nothing more we can do
    }
    return null
  }
}

export function writeDraft(key, values) {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(values))
  } catch {
    // quota exceeded / storage disabled — degrade silently, no persistence this session
  }
}

export function clearDraft(key) {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(key)
  } catch {
    // nothing to do if storage is unavailable
  }
}

export function debounce(fn, delayMs) {
  let timer

  function debounced(...args) {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delayMs)
  }

  debounced.cancel = () => clearTimeout(timer)

  return debounced
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/formDraftStorage.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/formDraftStorage.js tests/hooks/formDraftStorage.test.js
git commit -m "feat: add pure localStorage draft read/write/debounce helpers"
```

---

### Task 2: `useFormDraft` React hook

**Files:**
- Create: `lib/hooks/useFormDraft.js`

**Interfaces:**
- Consumes: `readDraft`, `writeDraft`, `clearDraft`, `debounce` from `lib/hooks/formDraftStorage.js` (Task 1).
- Produces: `useFormDraft(key: string, formMethods: { watch, reset, getValues }, options?: { enabled?: boolean }): { restored: boolean, clearDraft: () => void, dismissRestored: () => void }` — default export is a named export `useFormDraft`, consumed by Task 3 (`QuestionForm.js`) and Task 4 (`ExamSettingsForm.js`).

No automated test for this file: it's a thin `useEffect`/`useState` wrapper around Task 1's already-tested pure functions, and this repo's vitest config runs `environment: 'node'` with no `jsdom`/React Testing Library installed, so rendering hooks isn't possible without adding new test infra (out of scope per Global Constraints). It's verified manually in-browser in Task 5.

- [ ] **Step 1: Write the implementation**

Create `lib/hooks/useFormDraft.js`:

```js
'use client'

import { useEffect, useRef, useState } from 'react'
import { readDraft, writeDraft, clearDraft as clearDraftStorage, debounce } from './formDraftStorage'

const SAVE_DEBOUNCE_MS = 500

export function useFormDraft(key, { watch, reset, getValues }, { enabled = true } = {}) {
  const [restored, setRestored] = useState(false)
  const debouncedWriteRef = useRef(null)

  // Restore once on mount (or when the key identifies a different entity/form instance)
  useEffect(() => {
    if (!enabled) return
    const draft = readDraft(key)
    if (draft) {
      reset({ ...getValues(), ...draft })
      setRestored(true)
    }
    // Intentionally runs only when `key`/`enabled` change, not on every render —
    // this is a one-shot restore, not a continuous sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  // Debounced save on every field change
  useEffect(() => {
    if (!enabled) return

    debouncedWriteRef.current = debounce((values) => writeDraft(key, values), SAVE_DEBOUNCE_MS)
    const subscription = watch((values) => {
      debouncedWriteRef.current(values)
    })

    return () => {
      subscription.unsubscribe()
      debouncedWriteRef.current?.cancel?.()
    }
  }, [key, enabled, watch])

  function clearDraft() {
    clearDraftStorage(key)
  }

  function dismissRestored() {
    setRestored(false)
  }

  return { restored, clearDraft, dismissRestored }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/hooks/useFormDraft.js
git commit -m "feat: add useFormDraft hook wiring react-hook-form to localStorage"
```

---

### Task 3: Draft-restored banner + wire into `QuestionForm.js`

**Files:**
- Create: `components/shared/DraftBanner.js`
- Modify: `components/questions/QuestionForm.js`
- Modify: `app/lecturer/questions/new/page.js`
- Modify: `app/lecturer/questions/[id]/edit/page.js`

**Interfaces:**
- Consumes: `useFormDraft` (Task 2).
- Produces: `DraftBanner({ onDiscard, onDismiss }): JSX.Element`, a named export from `components/shared/DraftBanner.js`, reused by Task 4.

- [ ] **Step 1: Create the banner component**

Create `components/shared/DraftBanner.js`:

```js
'use client'

import { X } from 'lucide-react'

export function DraftBanner({ onDiscard, onDismiss }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-primary-light border border-primary/20 rounded-lg px-3 py-2.5 mb-6">
      <p className="text-xs text-primary/80">
        Draft restored from your last session.{' '}
        <button
          type="button"
          onClick={onDiscard}
          className="font-medium underline hover:no-underline"
        >
          Discard draft
        </button>
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-primary/60 hover:text-primary"
      >
        <X size={14} />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Wire the hook into `QuestionForm.js`**

In `components/questions/QuestionForm.js`, update the imports (after the existing imports, currently ending at line 18):

```js
import { useFormDraft } from '@/lib/hooks/useFormDraft'
import { DraftBanner } from '@/components/shared/DraftBanner'
```

Change the component signature (currently line 58, `export function QuestionForm({ question, courses }) {`) to accept `lecturerId`:

```js
export function QuestionForm({ question, courses, lecturerId }) {
```

`useForm`'s `getValues` isn't destructured today. Update the destructure block (currently lines 64–75) to add it alongside the existing fields:

```js
  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    getValues,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(questionSchema),
    defaultValues: buildDefaults(question),
  })
```

Immediately after that destructure block, add:

```js
  const draftKey = `oems:draft:${lecturerId}:question:${question?.id ?? 'new'}`
  const { restored, clearDraft, dismissRestored } = useFormDraft(draftKey, { watch, reset, getValues })
```

In `onSubmit` (currently lines 96–120), call `clearDraft()` right after the success toast, before `router.push`:

```js
      if (result?.error) {
        toast.error(result.error)
      } else {
        toast.success(isEdit ? 'Question updated' : 'Question saved')
        clearDraft()
        router.push('/lecturer/questions')
        router.refresh()
      }
```

Add a discard handler above the `return` statement:

```js
  function handleDiscardDraft() {
    clearDraft()
    reset(buildDefaults(question))
    dismissRestored()
  }
```

Render the banner at the top of the form body (currently line 159, right after `<div className="max-w-3xl mx-auto px-6 py-8 space-y-8">`):

```jsx
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
          {restored && (
            <DraftBanner onDiscard={handleDiscardDraft} onDismiss={dismissRestored} />
          )}

          {/* Section 1: Course + Type + Difficulty */}
```

- [ ] **Step 3: Thread `lecturerId` through the two question pages**

In `app/lecturer/questions/new/page.js`, change the final line from:

```js
  return <QuestionForm courses={courses} />
```

to:

```js
  return <QuestionForm courses={courses} lecturerId={user.id} />
```

In `app/lecturer/questions/[id]/edit/page.js`, change:

```js
  return <QuestionForm question={question} courses={courses ?? []} />
```

to:

```js
  return <QuestionForm question={question} courses={courses ?? []} lecturerId={user.id} />
```

- [ ] **Step 4: Run the existing test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: PASS (all existing tests plus Task 1's new ones).

- [ ] **Step 5: Commit**

```bash
git add components/shared/DraftBanner.js components/questions/QuestionForm.js app/lecturer/questions/new/page.js "app/lecturer/questions/[id]/edit/page.js"
git commit -m "feat: persist QuestionForm drafts to localStorage"
```

---

### Task 4: Wire draft persistence into `ExamSettingsForm.js`

**Files:**
- Modify: `components/exams/ExamSettingsForm.js`
- Modify: `app/lecturer/exams/new/page.js`
- Modify: `app/lecturer/exams/[id]/edit/page.js`

**Interfaces:**
- Consumes: `useFormDraft` (Task 2), `DraftBanner` (Task 3).

- [ ] **Step 1: Extract `buildDefaults(exam)` so discard can reuse it**

In `components/exams/ExamSettingsForm.js`, the `defaultValues` are currently built inline inside the `useForm({...})` call (lines 34–60). Extract that ternary into a top-level function placed after the `CURRENT_SESSION` constant (currently line 19):

```js
function buildDefaults(exam) {
  return exam
    ? {
        ...exam,
        duration_minutes:     exam.duration_minutes,
        entry_window_minutes: exam.entry_window_minutes ?? 10,
        pass_mark:            exam.pass_mark,
        randomise_questions:  exam.randomise_questions ?? false,
        randomise_options:   exam.randomise_options   ?? false,
        instructions:        exam.instructions ?? '',
        exam_mode:           exam.exam_mode ?? 'lab',
        proctoring_enabled:  exam.proctoring_enabled ?? false,
        show_calculator:     exam.show_calculator ?? false,
        tips:                exam.tips?.map(t => ({ value: t })) ?? [],
      }
    : {
        academic_session:     CURRENT_SESSION,
        duration_minutes:     60,
        entry_window_minutes: 10,
        pass_mark:            40,
        randomise_questions: false,
        randomise_options:   false,
        instructions:        '',
        exam_mode:           'lab',
        proctoring_enabled:  false,
        show_calculator:     false,
        tips:                [],
      }
}
```

Replace the `useForm` call's `defaultValues` (lines 31–61) to use it:

```js
  const {
    register,
    handleSubmit,
    watch,
    control,
    reset,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(examSettingsFormSchema),
    mode: 'onBlur',
    defaultValues: buildDefaults(exam),
  })
```

(This adds `reset` and `getValues` to the destructure, which weren't there before, and drops the inline ternary in favor of calling the new function.)

- [ ] **Step 2: Wire the hook**

Add imports at the top of the file (after the existing `lucide-react` import, currently line 17):

```js
import { useFormDraft } from '@/lib/hooks/useFormDraft'
import { DraftBanner } from '@/components/shared/DraftBanner'
```

Update the component signature (currently line 21) to accept `lecturerId`:

```js
export function ExamSettingsForm({ courses, exam = null, lecturerId }) {
```

Immediately after the `useFieldArray` call (currently lines 63–66), add:

```js
  const draftKey = `oems:draft:${lecturerId}:exam:${exam?.id ?? 'new'}`
  const { restored, clearDraft, dismissRestored } = useFormDraft(draftKey, { watch, reset, getValues })

  function handleDiscardDraft() {
    clearDraft()
    reset(buildDefaults(exam))
    dismissRestored()
  }
```

In `onSubmit` (currently lines 68–89), call `clearDraft()` right before the success toast:

```js
    toast.success(isEdit ? 'Exam settings saved.' : 'Exam created.')
    clearDraft()
    router.push(`/lecturer/exams/${result.id}`)
    router.refresh()
```

Render the banner as the first child inside the `<form>` (currently line 92, right after `className="space-y-8">`):

```jsx
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-8">
      {restored && (
        <DraftBanner onDiscard={handleDiscardDraft} onDismiss={dismissRestored} />
      )}

      {/* ── Basic info ──────────────────────────────────────────────────────── */}
```

- [ ] **Step 3: Thread `lecturerId` through the two exam pages**

In `app/lecturer/exams/new/page.js`, change:

```js
      <ExamSettingsForm courses={courses} />
```

to:

```js
      <ExamSettingsForm courses={courses} lecturerId={user.id} />
```

In `app/lecturer/exams/[id]/edit/page.js`, change:

```js
      <ExamSettingsForm courses={courses ?? []} exam={exam} />
```

to:

```js
      <ExamSettingsForm courses={courses ?? []} exam={exam} lecturerId={user.id} />
```

- [ ] **Step 4: Run the existing test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/exams/ExamSettingsForm.js app/lecturer/exams/new/page.js "app/lecturer/exams/[id]/edit/page.js"
git commit -m "feat: persist ExamSettingsForm drafts to localStorage"
```

---

### Task 5: Manual browser verification

No files change in this task — it exists to catch anything the (necessarily hook-untested, per Task 2) React wiring could get wrong before calling this done.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` and open a lecturer session (log in as a lecturer test account).

- [ ] **Step 2: Verify `QuestionForm` create-flow persistence**

Go to `/lecturer/questions/new`. Fill in the course, type a question body, add an answer option. Refresh the page. Confirm: fields are still filled, the "Draft restored" banner appears. Click "Discard draft"; confirm the form clears and the banner disappears. Refresh again; confirm the draft is gone (form is blank).

- [ ] **Step 3: Verify `QuestionForm` edit-flow persistence**

Open an existing question to edit. Change the body text. Refresh. Confirm the edited (unsaved) text is restored, not the original saved value. Submit successfully; confirm no leftover "Draft restored" banner appears on a fresh visit to that same question's edit page afterward.

- [ ] **Step 4: Verify `ExamSettingsForm` persistence**

Repeat steps 2–3 for `/lecturer/exams/new` and an existing exam's edit page, including adding a "tip" via the dynamic tips field array before refreshing.

- [ ] **Step 5: Verify per-lecturer scoping**

Log in as a second lecturer account in the same browser (or an incognito window sharing the same origin). Confirm the second lecturer does not see the first lecturer's draft on `/lecturer/questions/new`.

- [ ] **Step 6: Report results**

If any step fails, fix the relevant task's code and re-verify before considering this plan complete. If all steps pass, the plan is done — no commit needed for this task.

## Self-Review Notes

- **Spec coverage:** Hook behavior (§3 restore/persist/clear), key scoping (§2, per-lecturer + per-entity), UI banner (§4), non-goals (no expiry, no conflict detection) — all covered. Testing (§5) is adjusted: the spec's "unit tests for `useFormDraft`" become unit tests for the extracted pure `formDraftStorage` module instead, because this repo's vitest config has no `jsdom`/React Testing Library to render hooks in — documented in Global Constraints and Task 2, closed by Task 5's manual pass instead.
- **Type/signature consistency:** `useFormDraft(key, { watch, reset, getValues }, { enabled })` — same shape used in Task 2's definition, Task 3's `QuestionForm.js` call, and Task 4's `ExamSettingsForm.js` call. `DraftBanner({ onDiscard, onDismiss })` — same props used in both call sites.
- **No placeholders:** every step has literal code, not descriptions.
