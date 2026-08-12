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
  // Writes on every change to the persisted slices — not debounced like the
  // server save, since a localStorage write is cheap and the whole point is
  // zero-latency durability against a refresh or crash. timeRemaining is
  // deliberately excluded, both here (see dependency array) and in
  // serializeAttemptDraft itself — it's always recomputed from the
  // server-authoritative startedAt on the next mount, never trusted from
  // here. Depending on the specific slices rather than the whole `state`
  // object also means the once-a-second TICK action (which produces a new
  // state object every tick regardless of whether anything persisted
  // actually changed) doesn't re-run this effect — important both for not
  // writing to localStorage ~3600 times/hour for no reason, and so this
  // effect can't fire on a stray tick and re-write the draft just after
  // doSubmit has called clearDraft on the way out.
  useEffect(() => {
    writeDraft(draftKey, serializeAttemptDraft(state))
  }, [state.answers, state.currentIndex, state.flagged, draftKey])

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
      if (result?.error) {
        setSaveStatus(prev => ({ ...prev, [questionId]: 'error' }))
        return
      }
      setSaveStatus(prev => ({ ...prev, [questionId]: 'saved' }))
      setTimeout(() => {
        setSaveStatus(prev => {
          if (prev[questionId] !== 'saved') return prev
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
  // retryFailedSaves reads saveStatus via a ref rather than closing over the
  // state value directly, so its own identity stays stable across status
  // transitions (only changing when saveQuestion changes, which is itself
  // stable). This keeps the effects below — the online listener and,
  // especially, the interval sweep — from being torn down and rebuilt every
  // time a save status flips, which would otherwise reset the interval's
  // countdown before it ever fires.
  const saveStatusRef = useRef(saveStatus)
  useEffect(() => { saveStatusRef.current = saveStatus }, [saveStatus])

  // Guards against piling up concurrent retries for the same question — on a
  // genuinely hung connection (the exact case this sweep exists for) a
  // question can still be 'error' by the next 5s tick even though a retry
  // for it is already in flight. Since the server-side write is
  // last-write-wins, letting two overlapping retries race could let a slow
  // one land after a newer save and clobber it with a stale value.
  const retryingRef = useRef(new Set())

  const retryFailedSaves = useCallback(() => {
    Object.entries(saveStatusRef.current).forEach(([questionId, status]) => {
      if (status !== 'error' || retryingRef.current.has(questionId)) return
      retryingRef.current.add(questionId)
      saveQuestion(questionId, answersRef.current[questionId]).finally(() => {
        retryingRef.current.delete(questionId)
      })
    })
  }, [saveQuestion])

  // Fast path: retry the moment the browser reports connectivity back.
  useEffect(() => {
    window.addEventListener('online', retryFailedSaves)
    return () => window.removeEventListener('online', retryFailedSaves)
  }, [retryFailedSaves])

  // Fallback: navigator.onLine only reflects the network interface, not real
  // reachability (wifi connected, upstream down is a real case it misses) —
  // a 5s sweep is the necessary catch-all while anything is unsynced. The
  // interval itself is unconditional and stable (deps only on the now-stable
  // retryFailedSaves) so status churn can't reset its countdown; whether
  // there's actually anything to retry is checked fresh on each tick.
  useEffect(() => {
    const id = setInterval(() => {
      if (Object.values(saveStatusRef.current).includes('error')) {
        retryFailedSaves()
      }
    }, 5000)
    return () => clearInterval(id)
  }, [retryFailedSaves])

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function doSubmit(isAuto = false) {
    submittingRef.current = true
    setSubmitting(true)
    setShowConfirm(false)

    // Flush all pending debounced saves
    Object.keys(saveTimers.current).forEach(qid => clearTimeout(saveTimers.current[qid]))
    saveTimers.current = {}

    try {
      const saveResults = await Promise.all(
        questions.map(q => {
          const a = answersRef.current[q.question_id]
          return a !== undefined && a !== null && a !== ''
            ? saveAnswer(attemptId, q.question_id, a)
            : Promise.resolve(null)
        })
      )
      if (saveResults.some(r => r?.error)) {
        throw new Error('One or more answers failed to save')
      }

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
      // Either a network failure reaching the server at all, or one of the
      // flushed saves above came back with a server-reported {error} (not
      // just a thrown exception) — either way, recover to a retryable state
      // instead of spinning forever. Nothing is lost: the local draft is
      // untouched until submit actually succeeds. Any question that was
      // still 'saving' when the debounce timers got cleared above has no
      // pending timer left to eventually resolve it, so without this it
      // would be stuck on the spinner forever and the retry sweep would
      // never pick it up (it only watches for 'error') — demote those to
      // 'error' so the sweep adopts them.
      setSaveStatus(prev => {
        const next = { ...prev }
        for (const key of Object.keys(next)) {
          if (next[key] === 'saving') next[key] = 'error'
        }
        return next
      })
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
