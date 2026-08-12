# Exam Interface Offline Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student taking an exam in `ExamInterface.js` never loses their answers, position, or flags to a network blip or accidental reload, and a failed save/submit shows a truthful, quiet retry state instead of hanging forever.

**Architecture:** A new pure module (`lib/exam/attemptDraft.js`) builds the reducer's initial state by merging server-confirmed answers with a localStorage draft (reusing the same `formDraftStorage.js` read/write/clear primitives the lecturer forms already use) — deliberately excluding the countdown timer, which stays server-derived only. `ExamInterface.js` writes that draft on every state change, clears it on confirmed submit success, and gains per-question save-status tracking with a retry sweep for failed saves. `QuestionNav.js` gets a small indicator for any question with an unsynced answer.

**Tech Stack:** Next.js (App Router, client components), React `useReducer`/`useEffect`, native `localStorage` via the existing `lib/hooks/formDraftStorage.js` module, vitest (`environment: 'node'`).

## Global Constraints

- No new npm dependencies.
- Storage key: `oems:exam:${attemptId}` — already unique per (exam, student), no further scoping needed.
- `timeRemaining` is never read from or written into the localStorage draft — always computed fresh from `startedAt` + `duration_minutes`, exactly as today. This is a hard constraint: the exam-timing design's server-side enforcement assumes the client countdown is untrusted decoration, and letting a stored value seed it would reintroduce a client-trust gap.
- No draft expiry — cleared only on confirmed `submitExam` success, matching the lecturer-forms precedent.
- No change to server-side timing/integrity enforcement, proctoring, fullscreen handling, or violation tracking.
- Retry is simple: an `online` event listener plus a 5-second interval sweep while any question is in an error state. No exponential backoff, no persistent retry queue beyond "which question IDs currently read `'error'`."

---

### Task 1: Pure attempt-state module

**Files:**
- Create: `lib/exam/attemptDraft.js`
- Test: `tests/exam/attemptDraft.test.js`

**Interfaces:**
- Produces: `buildAttemptState(attemptId: string, responses: Array<{question_id, student_answer}>, startedAt: string, durationMinutes: number): {currentIndex: number, answers: object, flagged: Set, timeRemaining: number}` and `serializeAttemptDraft(state: {answers, currentIndex, flagged}): {answers: object, currentIndex: number, flagged: Array}` — both named exports, consumed by Task 2's `ExamInterface.js` changes.
- Consumes: `readDraft` from `lib/hooks/formDraftStorage.js` (already exists, unchanged).

- [ ] **Step 1: Write the failing tests**

Create `tests/exam/attemptDraft.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildAttemptState, serializeAttemptDraft } from '@/lib/exam/attemptDraft'

function createMockStorage() {
  const store = new Map()
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
}

describe('buildAttemptState', () => {
  let storage

  beforeEach(() => {
    storage = createMockStorage()
    vi.stubGlobal('localStorage', storage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const responses = [
    { question_id: 'q1', student_answer: 'A' },
    { question_id: 'q2', student_answer: null },
  ]
  const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5 min ago

  it('falls back to server-confirmed answers, index 0, and no flags when no local draft exists', () => {
    const state = buildAttemptState('attempt-1', responses, startedAt, 60)

    expect(state.answers).toEqual({ q1: 'A', q2: null })
    expect(state.currentIndex).toBe(0)
    expect(state.flagged).toEqual(new Set())
  })

  it('merges local draft answers over server-confirmed ones, local winning on conflict', () => {
    storage.setItem('oems:exam:attempt-1', JSON.stringify({
      answers: { q1: 'B', q3: 'C' },
      currentIndex: 1,
      flagged: ['q2'],
    }))

    const state = buildAttemptState('attempt-1', responses, startedAt, 60)

    expect(state.answers).toEqual({ q1: 'B', q2: null, q3: 'C' })
    expect(state.currentIndex).toBe(1)
    expect(state.flagged).toEqual(new Set(['q2']))
  })

  it('always computes timeRemaining from startedAt/duration, ignoring anything in the local draft', () => {
    storage.setItem('oems:exam:attempt-1', JSON.stringify({
      answers: {},
      currentIndex: 0,
      flagged: [],
      timeRemaining: 999999, // should never be read
    }))

    const state = buildAttemptState('attempt-1', responses, startedAt, 60)

    // 60 min duration, 5 min elapsed -> ~55 min = 3300s remaining
    expect(state.timeRemaining).toBeGreaterThan(3290)
    expect(state.timeRemaining).toBeLessThanOrEqual(3300)
  })

  it('clamps timeRemaining to 0 when duration has already elapsed', () => {
    const longAgo = new Date(Date.now() - 120 * 60 * 1000).toISOString() // 2 hours ago
    const state = buildAttemptState('attempt-1', responses, longAgo, 60)

    expect(state.timeRemaining).toBe(0)
  })

  it('keys the draft lookup by attemptId, so a different attempt never sees this draft', () => {
    storage.setItem('oems:exam:attempt-1', JSON.stringify({ answers: { q1: 'B' }, currentIndex: 1, flagged: [] }))

    const state = buildAttemptState('attempt-2', responses, startedAt, 60)

    expect(state.answers).toEqual({ q1: 'A', q2: null })
    expect(state.currentIndex).toBe(0)
  })

  it('falls back cleanly when the stored draft is corrupted JSON', () => {
    storage.setItem('oems:exam:attempt-1', '{not valid json')

    const state = buildAttemptState('attempt-1', responses, startedAt, 60)

    expect(state.answers).toEqual({ q1: 'A', q2: null })
    expect(state.currentIndex).toBe(0)
    expect(state.flagged).toEqual(new Set())
  })
})

describe('serializeAttemptDraft', () => {
  it('converts the flagged Set to an array and picks exactly answers/currentIndex/flagged', () => {
    const state = {
      answers: { q1: 'A' },
      currentIndex: 2,
      flagged: new Set(['q1', 'q3']),
      timeRemaining: 1200, // must NOT be included in the persisted shape
    }

    const draft = serializeAttemptDraft(state)

    expect(draft).toEqual({
      answers: { q1: 'A' },
      currentIndex: 2,
      flagged: ['q1', 'q3'],
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/exam/attemptDraft.test.js`
Expected: FAIL — `Failed to resolve import "@/lib/exam/attemptDraft"`.

- [ ] **Step 3: Write the implementation**

Create `lib/exam/attemptDraft.js`:

```js
import { readDraft } from '@/lib/hooks/formDraftStorage'

export function buildAttemptState(attemptId, responses, startedAt, durationMinutes) {
  const serverAnswers = {}
  for (const r of responses) {
    serverAnswers[r.question_id] = r.student_answer
  }

  const draft = readDraft(`oems:exam:${attemptId}`)

  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)

  return {
    currentIndex:  draft?.currentIndex ?? 0,
    answers:       { ...serverAnswers, ...(draft?.answers ?? {}) },
    flagged:       new Set(draft?.flagged ?? []),
    timeRemaining: Math.max(0, durationMinutes * 60 - elapsed),
  }
}

export function serializeAttemptDraft(state) {
  return {
    answers:      state.answers,
    currentIndex: state.currentIndex,
    flagged:      [...state.flagged],
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/exam/attemptDraft.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/exam/attemptDraft.js tests/exam/attemptDraft.test.js
git commit -m "feat: add pure exam-attempt local-draft state builder"
```

---

### Task 2: Wire local persistence and save-failure retry into ExamInterface.js

**Files:**
- Modify: `components/student/ExamInterface.js`

**Interfaces:**
- Consumes: `buildAttemptState`, `serializeAttemptDraft` (Task 1); `writeDraft`, `clearDraft` from `lib/hooks/formDraftStorage.js` (already exist, unchanged).
- No change to `ExamInterface`'s own props or how it's rendered by callers.

This task replaces the file's local-state and save/submit logic in one pass — the local-persistence write, the per-question save status, and the retry sweep all interleave inside `handleAnswerChange` and `doSubmit`, so splitting them into separate partial-diff steps would leave the file in an inconsistent intermediate state. Read the current file first (482 lines) to confirm it matches what's below before replacing it — if it's drifted, apply the same changes by intent rather than blindly overwriting.

- [ ] **Step 1: Replace the full contents of `components/student/ExamInterface.js`**

```jsx
'use client'

import { useReducer, useEffect, useRef, useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ChevronLeft, ChevronRight, Send, Loader2,
  LayoutGrid, X, AlertTriangle, Maximize, Check,
  Calculator, Lightbulb,
} from 'lucide-react'
import { ExamTimer } from '@/components/student/ExamTimer'
import { QuestionNav } from '@/components/student/QuestionNav'
import { AnswerForm } from '@/components/student/AnswerForm'
import { MathContent } from '@/components/ui/MathContent'
import { Calculator as CalculatorPanel } from '@/components/student/Calculator'
import { TipsPanel } from '@/components/student/TipsPanel'
import { ProctoringCamera } from '@/components/student/ProctoringCamera'
import { saveAnswer, submitExam } from '@/lib/actions/attempts'
import { buildAttemptState, serializeAttemptDraft } from '@/lib/exam/attemptDraft'
import { writeDraft, clearDraft } from '@/lib/hooks/formDraftStorage'

// ─── State ───────────────────────────────────────────────────────────────────

function reducer(state, action) {
  switch (action.type) {
    case 'SET_ANSWER':
      return { ...state, answers: { ...state.answers, [action.questionId]: action.value } }
    case 'TOGGLE_FLAG': {
      const flagged = new Set(state.flagged)
      flagged.has(action.questionId) ? flagged.delete(action.questionId) : flagged.add(action.questionId)
      return { ...state, flagged }
    }
    case 'NAVIGATE':
      return { ...state, currentIndex: Math.max(0, Math.min(action.index, action.max)) }
    case 'TICK':
      return { ...state, timeRemaining: Math.max(0, state.timeRemaining - 1) }
    default:
      return state
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ExamInterface({ exam, questions, attemptId, studentId, startedAt, responses, labMode = false, labCode }) {
  const router = useRouter()
  const draftKey = `oems:exam:${attemptId}`

  const [state, dispatch] = useReducer(
    reducer,
    null,
    () => buildAttemptState(attemptId, responses, startedAt, exam.duration_minutes)
  )

  const [submitting,    setSubmitting]    = useState(false)
  const [showConfirm,   setShowConfirm]   = useState(false)
  const [showMobileNav, setShowMobileNav] = useState(false)
  const [violations,    setViolations]    = useState(0)
  const [showWarning,   setShowWarning]   = useState(false)
  const [warningMsg,    setWarningMsg]    = useState('')
  const [saveStatus,    setSaveStatus]    = useState({}) // { [questionId]: 'saving' | 'saved' | 'error' }
  const [showCalc,      setShowCalc]      = useState(false)
  const [showTips,      setShowTips]      = useState(false)

  const autoSubmitted  = useRef(false)
  const submittingRef  = useRef(false)
  const saveTimers     = useRef({})
  const answersRef     = useRef(state.answers)
  useEffect(() => { answersRef.current = state.answers }, [state.answers])

  // ── Local draft persistence ─────────────────────────────────────────────────
  // Writes on every state change — not debounced like the server save, since
  // a localStorage write is cheap and the whole point is zero-latency
  // durability against a refresh or crash. timeRemaining is deliberately
  // excluded (see serializeAttemptDraft) — it's always recomputed from the
  // server-authoritative startedAt on the next mount, never trusted from here.
  useEffect(() => {
    writeDraft(draftKey, serializeAttemptDraft(state))
  }, [state, draftKey])

  // ── Timer ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => dispatch({ type: 'TICK' }), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (state.timeRemaining === 0 && !autoSubmitted.current) {
      autoSubmitted.current = true
      doSubmit(true)
    }
  }, [state.timeRemaining]) // eslint-disable-line

  // ── Fullscreen ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {})
    }
    return () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }
  }, [])

  useEffect(() => {
    function onFullscreenChange() {
      if (!document.fullscreenElement && !autoSubmitted.current && !submittingRef.current) {
        triggerViolation('You exited fullscreen. Please return to fullscreen to continue.')
        // Re-request fullscreen after a short delay
        setTimeout(() => {
          document.documentElement.requestFullscreen?.().catch(() => {})
        }, 1500)
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, []) // eslint-disable-line

  // ── Tab / window visibility ─────────────────────────────────────────────────
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden && !autoSubmitted.current && !submittingRef.current) {
        triggerViolation('You switched away from the exam window. This has been recorded.')
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, []) // eslint-disable-line

  function triggerViolation(message) {
    setViolations(prev => {
      const next = prev + 1
      setWarningMsg(message)
      setShowWarning(true)

      // 3 strikes → auto-submit
      if (next >= 3 && !autoSubmitted.current) {
        autoSubmitted.current = true
        toast.error('Exam auto-submitted due to repeated malpractice violations.')
        doSubmit(true)
      }
      return next
    })
  }

  // ── Answer save (debounced, with retry on failure) ──────────────────────────
  const saveQuestion = useCallback(async (questionId, value) => {
    try {
      const result = await saveAnswer(attemptId, questionId, value)
      // The server is the source of truth on time, not this component's
      // local countdown — if it says time's up (e.g. the local timer was
      // tampered with, or the two clocks drifted), funnel into the same
      // submit flow the countdown hitting zero already uses, rather than
      // just showing a failed-save error.
      if (result?.timeExpired && !autoSubmitted.current) {
        autoSubmitted.current = true
        toast.info('Time is up — submitting your exam…')
        doSubmit(true)
        return
      }
      setSaveStatus(prev => ({ ...prev, [questionId]: 'saved' }))
      setTimeout(() => {
        setSaveStatus(prev => {
          const { [questionId]: _discard, ...rest } = prev
          return rest
        })
      }, 2000)
    } catch {
      // Network failure (or any thrown error) — mark unsynced instead of
      // leaving the status stuck on 'saving' forever. The retry effects
      // below pick this up.
      setSaveStatus(prev => ({ ...prev, [questionId]: 'error' }))
    }
  }, [attemptId]) // eslint-disable-line

  const handleAnswerChange = useCallback((questionId, value) => {
    dispatch({ type: 'SET_ANSWER', questionId, value })
    setSaveStatus(prev => ({ ...prev, [questionId]: 'saving' }))
    clearTimeout(saveTimers.current[questionId])
    saveTimers.current[questionId] = setTimeout(() => saveQuestion(questionId, value), 800)
  }, [saveQuestion])

  // ── Retry sweep for unsynced answers ────────────────────────────────────────
  const retryFailedSaves = useCallback(() => {
    Object.entries(saveStatus).forEach(([questionId, status]) => {
      if (status === 'error') saveQuestion(questionId, answersRef.current[questionId])
    })
  }, [saveStatus, saveQuestion])

  // Fast path: retry the moment the browser reports connectivity back.
  useEffect(() => {
    window.addEventListener('online', retryFailedSaves)
    return () => window.removeEventListener('online', retryFailedSaves)
  }, [retryFailedSaves])

  // Fallback: navigator.onLine only reflects the network interface, not real
  // reachability (wifi connected, upstream down is a real case it misses) —
  // a 5s sweep is the necessary catch-all while anything is unsynced.
  useEffect(() => {
    const hasErrors = Object.values(saveStatus).includes('error')
    if (!hasErrors) return
    const id = setInterval(retryFailedSaves, 5000)
    return () => clearInterval(id)
  }, [saveStatus, retryFailedSaves])

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function doSubmit(isAuto = false) {
    submittingRef.current = true
    setSubmitting(true)
    setShowConfirm(false)

    // Flush all pending debounced saves
    Object.keys(saveTimers.current).forEach(qid => clearTimeout(saveTimers.current[qid]))
    saveTimers.current = {}

    try {
      await Promise.all(
        questions.map(q => {
          const a = answersRef.current[q.question_id]
          return a !== undefined && a !== null && a !== ''
            ? saveAnswer(attemptId, q.question_id, a)
            : Promise.resolve()
        })
      )

      const result = await submitExam(attemptId)
      if (result?.error) {
        toast.error(result.error)
        setSubmitting(false)
        submittingRef.current = false
        return
      }

      clearDraft(draftKey)
      if (isAuto) toast.info('Your exam has been submitted.')
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      router.push(`/lab/${labCode}/result`)
    } catch {
      // Network failure reaching the server at all (not a server-returned
      // error) — recover to a retryable state instead of spinning forever.
      // Nothing is lost: the local draft is untouched until submit actually
      // succeeds.
      toast.error("Couldn't submit — check your connection and try again.")
      setSubmitting(false)
      submittingRef.current = false
      autoSubmitted.current = false
    }
  }

  function handleSubmitClick() {
    const unanswered = questions.filter(q => {
      const a = state.answers[q.question_id]
      if (a === null || a === undefined || a === '') return true
      if (Array.isArray(a)) return a.length === 0
      return false
    }).length
    unanswered > 0 ? setShowConfirm(true) : doSubmit(false)
  }

  // ── Current question ─────────────────────────────────────────────────────────
  const q             = questions[state.currentIndex]
  const total         = questions.length
  const answeredCount = questions.filter(q => {
    const a = state.answers[q.question_id]
    if (a === null || a === undefined || a === '') return false
    if (Array.isArray(a)) return a.length > 0
    return true
  }).length

  return (
    <div className="flex h-screen overflow-hidden bg-page">

      {/* ── Malpractice warning banner ──────────────────────────────────── */}
      {showWarning && (
        <div className="fixed top-0 inset-x-0 z-50 bg-danger text-white px-4 py-3 flex items-center gap-3">
          <AlertTriangle size={16} className="shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{warningMsg}</p>
            <p className="text-xs text-white/75">
              Warning {violations} of 3 — third violation will auto-submit your exam.
            </p>
          </div>
          <button onClick={() => setShowWarning(false)} className="shrink-0 text-white/70 hover:text-white">
            <X size={16} />
          </button>
          {violations < 3 && (
            <button
              onClick={() => {
                document.documentElement.requestFullscreen?.().catch(() => {})
                setShowWarning(false)
              }}
              className="shrink-0 flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors"
            >
              <Maximize size={13} />
              Return to fullscreen
            </button>
          )}
        </div>
      )}

      {/* ── Main area ──────────────────────────────────────────────────────── */}
      <div className={`flex-1 flex flex-col min-w-0 ${showWarning ? 'pt-14' : ''}`}>

        {/* Top bar */}
        <div className="bg-surface border-b border-border shrink-0">
          <div className="flex items-center justify-between px-4 md:px-6 py-3">
            <div className="min-w-0 flex-1 mr-4">
              <p className="text-sm font-semibold text-text-primary truncate">{exam.title}</p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-text-muted">
                  Question {state.currentIndex + 1} of {total} · {answeredCount} answered
                </p>
                {saveStatus[q.question_id] === 'saving' && (
                  <span className="flex items-center gap-1 text-xs text-text-muted">
                    <Loader2 size={10} className="animate-spin" />
                    Saving…
                  </span>
                )}
                {saveStatus[q.question_id] === 'saved' && (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <Check size={10} />
                    Saved
                  </span>
                )}
                {saveStatus[q.question_id] === 'error' && (
                  <span className="flex items-center gap-1 text-xs text-text-muted">
                    <AlertTriangle size={10} />
                    Will retry
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Mobile question nav trigger */}
              <button
                onClick={() => setShowMobileNav(true)}
                className="lg:hidden flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs text-text-secondary hover:bg-slate-50 transition-colors"
              >
                <LayoutGrid size={13} />
                Questions
              </button>
              {/* Tool buttons */}
              {exam.tips?.length > 0 && (
                <button
                  onClick={() => setShowTips(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    showTips
                      ? 'bg-amber-100 border-amber-300 text-amber-800'
                      : 'border-border text-text-secondary hover:bg-slate-50'
                  }`}
                  title="Exam tips"
                >
                  <Lightbulb size={13} />
                  <span className="hidden sm:inline">Tips</span>
                </button>
              )}
              {exam.show_calculator && (
                <button
                  onClick={() => setShowCalc(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    showCalc
                      ? 'bg-primary-light border-primary/30 text-primary'
                      : 'border-border text-text-secondary hover:bg-slate-50'
                  }`}
                  title="Calculator"
                >
                  <Calculator size={13} />
                  <span className="hidden sm:inline">Calc</span>
                </button>
              )}
            </div>
          </div>

          {/* Mobile timer — its own full-width row so it reads as the most
              important thing in the header instead of blending into the
              button row above. It's part of this persistent, non-scrolling
              top bar (not a fixed overlay), so it can never cover question
              content — it just adds normal header height, same as the
              desktop sidebar already dedicates its own top slot to it. */}
          <div className="lg:hidden px-4 pb-3 flex justify-center">
            <ExamTimer timeRemaining={state.timeRemaining} />
          </div>
        </div>

        {/* Question body */}
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 md:py-8 max-w-3xl mx-auto w-full">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-text-muted bg-slate-100 px-2 py-0.5 rounded">
                Q{state.currentIndex + 1}
              </span>
              <span className="text-xs text-text-muted">{q.marks} {q.marks === 1 ? 'mark' : 'marks'}</span>
            </div>
            <button
              onClick={() => dispatch({ type: 'TOGGLE_FLAG', questionId: q.question_id })}
              className={[
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors',
                state.flagged.has(q.question_id)
                  ? 'bg-warning-light border-warning/30 text-warning'
                  : 'border-border text-text-muted hover:border-warning/40 hover:text-warning',
              ].join(' ')}
            >
              {state.flagged.has(q.question_id) ? '⚑ Flagged' : '⚐ Flag for review'}
            </button>
          </div>

          <MathContent
            html={q.body}
            className="tiptap text-base text-text-primary leading-relaxed mb-8 prose prose-sm max-w-none"
          />

          <AnswerForm
            question={q}
            answer={state.answers[q.question_id]}
            onChange={value => handleAnswerChange(q.question_id, value)}
          />
        </div>

        {/* Bottom navigation */}
        <div className="shrink-0 flex items-center justify-between px-4 md:px-6 py-4 bg-surface border-t border-border gap-2">
          <button
            onClick={() => dispatch({ type: 'NAVIGATE', index: state.currentIndex - 1, max: total - 1 })}
            disabled={state.currentIndex === 0}
            className="flex items-center gap-1.5 px-3 md:px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={16} />
            <span className="hidden sm:inline">Previous</span>
          </button>

          <button
            onClick={handleSubmitClick}
            disabled={submitting}
            className="flex items-center gap-2 px-4 md:px-5 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover disabled:opacity-60 transition-colors"
          >
            {submitting ? (
              <><Loader2 size={15} className="animate-spin" /><span className="hidden sm:inline">Submitting…</span></>
            ) : (
              <><Send size={15} /><span className="hidden sm:inline">Submit Exam</span><span className="sm:hidden">Submit</span></>
            )}
          </button>

          <button
            onClick={() => dispatch({ type: 'NAVIGATE', index: state.currentIndex + 1, max: total - 1 })}
            disabled={state.currentIndex === total - 1}
            className="flex items-center gap-1.5 px-3 md:px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* ── Desktop sidebar ─────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-72 border-l border-border bg-surface overflow-y-auto shrink-0">
        <div className="p-4 border-b border-border">
          <ExamTimer timeRemaining={state.timeRemaining} />
        </div>
        <div className="flex-1 p-4">
          <QuestionNav
            questions={questions}
            answers={state.answers}
            flagged={state.flagged}
            currentIndex={state.currentIndex}
            saveStatus={saveStatus}
            onNavigate={index => dispatch({ type: 'NAVIGATE', index, max: total - 1 })}
          />
        </div>
      </aside>

      {/* ── Mobile question nav drawer ──────────────────────────────────────── */}
      {showMobileNav && (
        <div className="lg:hidden fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileNav(false)} />
          <div className="relative w-72 bg-surface h-full overflow-y-auto shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-semibold text-text-primary">Questions</span>
              <button onClick={() => setShowMobileNav(false)} className="p-1.5 rounded text-text-muted hover:text-text-primary">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 p-4">
              <QuestionNav
                questions={questions}
                answers={state.answers}
                flagged={state.flagged}
                currentIndex={state.currentIndex}
                saveStatus={saveStatus}
                onNavigate={index => {
                  dispatch({ type: 'NAVIGATE', index, max: total - 1 })
                  setShowMobileNav(false)
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Unanswered confirmation modal ──────────────────────────────────── */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-base font-semibold text-text-primary mb-2">Submit exam?</h2>
            <p className="text-sm text-text-secondary mb-5">
              {questions.filter(q => {
                const a = state.answers[q.question_id]
                if (a === null || a === undefined || a === '') return true
                return Array.isArray(a) && a.length === 0
              }).length} question(s) are unanswered. You cannot change answers after submitting.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => doSubmit(false)}
                className="flex-1 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-hover transition-colors"
              >
                Submit anyway
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2.5 border border-border text-text-primary text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors"
              >
                Review answers
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Floating tools ─────────────────────────────────────────────────── */}
      {showCalc && exam.show_calculator && (
        <CalculatorPanel onClose={() => setShowCalc(false)} />
      )}
      {showTips && exam.tips?.length > 0 && (
        <TipsPanel tips={exam.tips} onClose={() => setShowTips(false)} />
      )}
      {exam.proctoring_enabled && studentId && (
        <ProctoringCamera attemptId={attemptId} studentId={studentId} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: PASS (all existing tests plus Task 1's new ones).

- [ ] **Step 3: Commit**

```bash
git add components/student/ExamInterface.js
git commit -m "feat: persist exam attempt state locally and retry failed saves"
```

---

### Task 3: QuestionNav unsynced indicator

**Files:**
- Modify: `components/student/QuestionNav.js`

**Interfaces:**
- Consumes: a new optional `saveStatus` prop, shape `{ [questionId]: 'saving' | 'saved' | 'error' }` (already passed by Task 2's `ExamInterface.js`).

- [ ] **Step 1: Replace the full contents of `components/student/QuestionNav.js`**

```jsx
'use client'

import { Bookmark, RefreshCw } from 'lucide-react'

export function QuestionNav({ questions, answers, flagged, currentIndex, saveStatus = {}, onNavigate }) {
  const answeredCount = questions.filter(q => {
    const a = answers[q.question_id]
    if (a === null || a === undefined || a === '') return false
    if (Array.isArray(a)) return a.length > 0
    return true
  }).length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Questions</span>
        <span className="text-xs text-text-muted">{answeredCount}/{questions.length} answered</span>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {questions.map((q, index) => {
          const isAnswered = (() => {
            const a = answers[q.question_id]
            if (a === null || a === undefined || a === '') return false
            if (Array.isArray(a)) return a.length > 0
            return true
          })()
          const isFlagged  = flagged.has(q.question_id)
          const isCurrent  = index === currentIndex
          const isUnsynced = saveStatus[q.question_id] === 'error'

          let btnClass = 'relative w-full aspect-square rounded-lg text-xs font-medium transition-all flex items-center justify-center '

          if (isCurrent) {
            btnClass += 'ring-2 ring-primary ring-offset-1 '
          }

          if (isFlagged) {
            btnClass += 'bg-warning-light text-warning border border-warning/30'
          } else if (isAnswered) {
            btnClass += 'bg-primary text-white'
          } else {
            btnClass += 'border border-border text-text-muted hover:border-primary/40 hover:text-primary'
          }

          return (
            <button
              key={q.question_id}
              onClick={() => onNavigate(index)}
              aria-label={`Question ${index + 1}${isAnswered ? ', answered' : ''}${isFlagged ? ', flagged' : ''}${isUnsynced ? ', not yet synced' : ''}`}
              className={btnClass}
            >
              {index + 1}
              {isFlagged && (
                <Bookmark size={8} className="absolute top-0.5 right-0.5 fill-current" />
              )}
              {isUnsynced && (
                <RefreshCw size={8} className="absolute top-0.5 left-0.5 text-amber-600" />
              )}
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 pt-1">
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="w-3 h-3 rounded border border-border inline-block" />
          Unanswered
        </span>
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="w-3 h-3 rounded bg-primary inline-block" />
          Answered
        </span>
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="w-3 h-3 rounded bg-warning-light border border-warning/30 inline-block" />
          Flagged
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/student/QuestionNav.js
git commit -m "feat: show unsynced-answer indicator in exam question nav"
```

---

### Task 4: Manual browser verification

No files change in this task.

- [ ] **Step 1: Start the dev server and begin an exam**

Run `npm run dev`, log in as a student (or use `/lab/{code}`), start an exam.

- [ ] **Step 2: Verify local persistence survives a reload**

Answer a couple of questions, flag one, navigate to a different question (not question 1). Refresh the page. Confirm: the same question is still shown (not reset to question 1), the flag is still set, and previously-typed answers are still there.

- [ ] **Step 3: Verify save-failure retry**

Open devtools → Network tab → set throttling to "Offline". Type an answer. Confirm the top-bar indicator shows "Will retry" (not a spinner stuck on "Saving…" forever), and the question's nav-grid button shows the small unsynced dot. Set throttling back to "Online" (or "No throttling"). Within a few seconds (or immediately, since the `online` event should fire), confirm the indicator changes to "Saved" and the unsynced dot disappears.

- [ ] **Step 4: Verify submit failure doesn't lose data**

With devtools still able to toggle offline: go offline, click "Submit Exam" (confirm through the unanswered-questions dialog if it appears). Confirm a toast error appears ("Couldn't submit…") and the button becomes clickable again instead of spinning forever. Go back online, click Submit again — confirm it now succeeds and redirects to the results page.

- [ ] **Step 5: Verify the draft is cleared after a successful submit**

After Step 4's successful submit, open devtools → Application/Storage → Local Storage, and confirm the `oems:exam:<attemptId>` key for that attempt is gone.

- [ ] **Step 6: Report results**

If any step fails, fix the relevant task's code and re-verify before considering this plan complete. If all steps pass, the plan is done — no commit needed for this task.

## Self-Review Notes

- **Spec coverage:** §1 (local persistence: key, shape, write timing, restore/merge, timeRemaining exclusion, clear-on-submit-success) → Tasks 1-2. §2 (save-failure handling: per-question status, try/catch, retry via `online` + interval sweep, submit-failure recovery) → Task 2. §3 (UI: top-bar per-question status, QuestionNav indicator) → Tasks 2-3. Non-goals (no offline-taking mode, no server-side timing changes, no proctoring/fullscreen changes, no draft expiry) — none of them have a task, correctly. Admin-forms persistence is explicitly out of scope for this plan per the design doc.
- **Type/signature consistency:** `buildAttemptState`'s return shape (`currentIndex`, `answers`, `flagged`, `timeRemaining`) matches exactly what the existing `reducer`/JSX already expect (unchanged from the original `buildInitialState`, just relocated and extended). `serializeAttemptDraft`'s output shape (`answers`, `currentIndex`, `flagged` as an array) matches exactly what `buildAttemptState` reads back via `draft?.currentIndex`/`draft?.answers`/`draft?.flagged`. The `saveStatus` shape (`{ [questionId]: 'saving'|'saved'|'error' }`) is used identically in Task 2's `ExamInterface.js` (top-bar lookup, `retryFailedSaves`) and Task 3's `QuestionNav.js` (`saveStatus[q.question_id] === 'error'`).
- **No placeholders:** every step has literal, complete code. `ExamInterface.js` is reproduced in full (not diffed) given how much of it changes and how interleaved the changes are across `handleAnswerChange`/`doSubmit`/the render — a partial diff description would be far more error-prone here than the verbose-but-unambiguous full-file replacement, matching the precedent set by the auth.js/studentAuth.js tasks in the login-logging plan.
