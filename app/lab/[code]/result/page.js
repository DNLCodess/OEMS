import { notFound } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, XCircle, Clock, ChevronLeft, MessageSquare } from 'lucide-react'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Badge } from '@/components/ui/Badge'
import { stripHtml } from '@/lib/utils'
import { MatricEntryForm } from '../MatricEntryForm'
import { Monitor } from 'lucide-react'
import { BrandedPageBackground } from '@/components/shared/BrandedPageBackground'

export const metadata = { title: 'Exam Result — OEMS Lab' }

export default async function LabResultPage({ params }) {
  const { code } = await params
  const upperCode = code.toUpperCase()

  // Same unauthenticated-safe lookup pattern as the lobby: only the exam's
  // existence is checked before authentication, via the admin client.
  const adminClient = createAdminClient()
  const { data: examBasic, error: examBasicError } = await adminClient
    .from('exams')
    .select('id')
    .eq('access_code', upperCode)
    .maybeSingle()

  if (examBasicError) {
    console.error('[LabResultPage]', examBasicError)
    return (
      <BrandedPageBackground>
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-sm text-text-muted">Failed to load this exam. Please refresh.</p>
        </div>
      </BrandedPageBackground>
    )
  }

  if (!examBasic) notFound()

  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()

  const isAuthedForThisExam =
    authUser?.app_metadata?.session_channel === 'exam_access' &&
    authUser?.app_metadata?.verified_exam_id === examBasic.id

  if (!isAuthedForThisExam) {
    return (
      <BrandedPageBackground>
        <div className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-sm">
            <div className="flex items-center justify-center gap-2 mb-6">
              <span className="flex items-center gap-1.5 bg-primary text-white text-xs font-semibold px-3 py-1.5 rounded-full">
                <Monitor size={12} />
                Lab Session · Code: {upperCode}
              </span>
            </div>
            <MatricEntryForm code={upperCode} />
          </div>
        </div>
      </BrandedPageBackground>
    )
  }

  const user     = await requireRole('student')
  const examId   = examBasic.id

  const { data: exam, error: examError } = await supabase
    .from('exams')
    .select('id, title, pass_mark, duration_minutes, courses ( course_code )')
    .eq('id', examId)
    .single()

  if (examError) {
    console.error('[LabResultPage]', examError)
    return (
      <BrandedPageBackground>
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-sm text-text-muted">Failed to load this exam. Please refresh.</p>
        </div>
      </BrandedPageBackground>
    )
  }

  if (!exam) notFound()

  const { data: attempt, error: attemptError } = await supabase
    .from('attempts')
    .select('id, status, submitted_at, total_score')
    .eq('exam_id', examId)
    .eq('student_id', user.id)
    .maybeSingle()

  // A submitted attempt normally has a result row by now (written in the
  // same request that marks it submitted) — this guards a rare edge case
  // (e.g. a transient DB error during submission) rather than a normal
  // expected state.
  const { data: result, error: resultError } = await supabase
    .from('results')
    .select('final_score, passed')
    .eq('exam_id', examId)
    .eq('student_id', user.id)
    .maybeSingle()

  const { data: examQuestions, error: examQuestionsError } = await supabase
    .from('exam_questions')
    .select('question_id, marks')
    .eq('exam_id', examId)

  // Hard stop, never render a possibly-wrong score — the score card and
  // breakdown depend entirely on result/examQuestions being trustworthy
  // (see plan design doc: correctness-critical, not a dashboard stat).
  if (attemptError || resultError || examQuestionsError) {
    console.error('[LabResultPage]', attemptError || resultError || examQuestionsError)
    return (
      <BrandedPageBackground>
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <p className="text-sm text-text-muted max-w-sm">
            Failed to load your result. Please refresh, or contact your exam officer if this persists.
          </p>
        </div>
      </BrandedPageBackground>
    )
  }

  const totalPossible = (examQuestions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)

  let responses = []
  if (result && attempt) {
    const { data: rawResponses, error: responsesError } = await supabase
      .from('responses')
      .select(`
        question_id, student_answer, is_correct, marks_awarded, teacher_feedback,
        question_bank:question_id ( type, body, options, explanation )
      `)
      .eq('attempt_id', attempt.id)
    if (responsesError) console.error('[LabResultPage]', responsesError)

    responses = rawResponses ?? []
  }

  // ── Not yet submitted ──────────────────────────────────────────────────────
  if (!attempt || attempt.status === 'in_progress') {
    return (
      <BrandedPageBackground>
        <div className="max-w-lg mx-auto px-6 py-16 text-center">
          <Clock size={40} className="mx-auto text-text-muted mb-4" />
          <h1 className="text-xl font-bold text-text-primary mb-2">Exam not yet submitted</h1>
          <p className="text-sm text-text-secondary mb-6">
            You haven&apos;t completed this exam yet.
          </p>
          <Link href={`/lab/${upperCode}`} className="text-primary text-sm hover:underline">
            Go to exam →
          </Link>
        </div>
      </BrandedPageBackground>
    )
  }

  // ── Result not yet available ───────────────────────────────────────────────
  if (!result) {
    return (
      <BrandedPageBackground>
        <div className="max-w-lg mx-auto px-6 py-16 text-center">
          <Clock size={40} className="mx-auto text-text-muted mb-4" />
          <h1 className="text-xl font-bold text-text-primary mb-2">Result pending</h1>
          <p className="text-sm text-text-secondary mb-6">
            Your result is being finalized. Please check back shortly, or contact your exam officer if this persists.
          </p>
          <Link href={`/lab/${upperCode}`} className="text-primary text-sm hover:underline">
            Back to exam →
          </Link>
        </div>
      </BrandedPageBackground>
    )
  }

  // ── Result available ────────────────────────────────────────────────────────
  const percentage = totalPossible > 0
    ? Math.round((result.final_score / totalPossible) * 100)
    : 0

  return (
    <BrandedPageBackground>
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Link
          href={`/lab/${upperCode}`}
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors mb-6"
        >
          <ChevronLeft size={14} />
          Back to lab session
        </Link>

        {/* Score card */}
        <div className={[
          'rounded-2xl p-8 mb-8 text-center border',
          result.passed
            ? 'bg-success-light border-success/20'
            : 'bg-danger-light border-danger/20',
        ].join(' ')}>
          <div className="flex items-center justify-center gap-2 mb-4">
            {result.passed
              ? <CheckCircle2 size={28} className="text-success" />
              : <XCircle    size={28} className="text-danger"  />
            }
            <span className={`text-lg font-bold ${result.passed ? 'text-success' : 'text-danger'}`}>
              {result.passed ? 'Pass' : 'Fail'}
            </span>
          </div>

          <p className="text-5xl font-bold text-text-primary mb-1 tabular-nums">
            {result.final_score}
            <span className="text-2xl text-text-muted">/{totalPossible}</span>
          </p>
          <p className="text-lg text-text-secondary font-medium mb-4">{percentage}%</p>

          <div className="flex items-center justify-center gap-4 text-sm text-text-muted">
            <span>{exam.title}</span>
            <span>·</span>
            <span className="font-mono">{exam.courses?.course_code}</span>
            <span>·</span>
            <span>Pass mark: {exam.pass_mark}%</span>
          </div>
        </div>

        {/* Question breakdown */}
        {responses.length > 0 && (
          <div>
            <h2 className="text-base font-semibold text-text-primary mb-4">
              Question Breakdown
            </h2>
            <div className="space-y-3">
              {responses.map((r) => {
                const qb = r.question_bank
                return (
                  <div
                    key={r.question_id}
                    className={[
                      'flex items-start gap-4 p-4 rounded-xl border',
                      r.is_correct ? 'border-success/20 bg-success-light' : 'border-danger/20 bg-danger-light',
                    ].join(' ')}
                  >
                    <div className="shrink-0 mt-0.5">
                      {r.is_correct
                        ? <CheckCircle2 size={16} className="text-success" />
                        : <XCircle     size={16} className="text-danger"  />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary line-clamp-2 mb-1">
                        {stripHtml(qb?.body)}
                      </p>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={qb?.type} />
                        <span className="text-xs text-text-muted">
                          {r.marks_awarded} mark{r.marks_awarded !== 1 ? 's' : ''} awarded
                        </span>
                      </div>
                      {qb?.explanation && (
                        <p className="text-xs text-text-secondary mt-1 italic">
                          Explanation: {stripHtml(qb.explanation)}
                        </p>
                      )}
                      {r.teacher_feedback && (
                        <div className="flex items-start gap-1 mt-1">
                          <MessageSquare size={11} className="shrink-0 mt-0.5 text-primary" />
                          <p className="text-xs text-primary">{r.teacher_feedback}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-8 text-center">
          <Link href={`/lab/${upperCode}`} className="text-sm text-primary hover:underline">
            ← Back to lab session
          </Link>
        </div>
      </div>
    </BrandedPageBackground>
  )
}
