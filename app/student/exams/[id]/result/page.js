import { notFound } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, XCircle, Clock, ChevronLeft, MessageSquare } from 'lucide-react'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/Badge'
import { stripHtml } from '@/lib/utils'

export const metadata = { title: 'Exam Result' }

export default async function ResultPage({ params }) {
  const user     = await requireRole('student')
  const supabase = await createClient()
  const { id: examId } = await params

  // Fetch exam
  const { data: exam } = await supabase
    .from('exams')
    .select('id, title, pass_mark, duration_minutes, courses ( course_code )')
    .eq('id', examId)
    .eq('university_id', user.university_id)
    .single()

  if (!exam) notFound()

  // Fetch the student's attempt
  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, status, submitted_at, total_score')
    .eq('exam_id', examId)
    .eq('student_id', user.id)
    .maybeSingle()

  // Fetch released result (null if not yet released)
  const { data: result } = await supabase
    .from('results')
    .select('final_score, passed, released_at')
    .eq('exam_id', examId)
    .eq('student_id', user.id)
    .not('released_at', 'is', null)
    .maybeSingle()

  // Fetch total possible marks
  const { data: examQuestions } = await supabase
    .from('exam_questions')
    .select('question_id, marks')
    .eq('exam_id', examId)

  const totalPossible = (examQuestions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)

  // If result released, fetch responses for breakdown
  let responses = []
  if (result && attempt) {
    const { data: rawResponses } = await supabase
      .from('responses')
      .select(`
        question_id, student_answer, is_correct, marks_awarded, teacher_feedback,
        question_bank:question_id ( type, body, options, explanation )
      `)
      .eq('attempt_id', attempt.id)

    responses = rawResponses ?? []
  }

  // ── Not yet submitted ──────────────────────────────────────────────────────
  if (!attempt || attempt.status === 'in_progress') {
    return (
      <div className="max-w-lg mx-auto px-6 py-16 text-center">
        <Clock size={40} className="mx-auto text-text-muted mb-4" />
        <h1 className="text-xl font-bold text-text-primary mb-2">Exam not yet submitted</h1>
        <p className="text-sm text-text-secondary mb-6">
          You haven't completed this exam yet.
        </p>
        <Link href={`/student/exams/${examId}`} className="text-primary text-sm hover:underline">
          Go to exam →
        </Link>
      </div>
    )
  }

  // ── Submitted but result not released ──────────────────────────────────────
  if (!result) {
    return (
      <div className="max-w-lg mx-auto px-6 py-16 text-center">
        <div className="w-16 h-16 bg-primary-light rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={28} className="text-primary" />
        </div>
        <h1 className="text-xl font-bold text-text-primary mb-2">Exam submitted!</h1>
        <p className="text-sm text-text-secondary mb-1">
          Your answers have been received and are being reviewed.
        </p>
        <p className="text-sm text-text-muted">
          Results will appear here once your lecturer releases them.
        </p>
        <Link href="/student/exams" className="inline-block mt-6 text-primary text-sm hover:underline">
          ← Back to my exams
        </Link>
      </div>
    )
  }

  // ── Result released ────────────────────────────────────────────────────────
  const percentage = totalPossible > 0
    ? Math.round((result.final_score / totalPossible) * 100)
    : 0

  const autoGradedResponses  = responses.filter(r => r.is_correct !== null)
  const manualResponses      = responses.filter(r => r.is_correct === null)

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {/* Back */}
      <Link
        href="/student/exams"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors mb-6"
      >
        <ChevronLeft size={14} />
        My Exams
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
      {autoGradedResponses.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-text-primary mb-4">
            Question Breakdown
          </h2>
          <div className="space-y-3">
            {autoGradedResponses.map((r, index) => {
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

      {manualResponses.length > 0 && (
        <div className="mt-6 p-4 bg-surface border border-border rounded-xl">
          <p className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">{manualResponses.length} question(s)</span>{' '}
            (short answer / essay) will be graded manually by your lecturer.
            Your score above reflects auto-graded questions only.
          </p>
        </div>
      )}

      <div className="mt-8 text-center">
        <Link href="/student/exams" className="text-sm text-primary hover:underline">
          ← Back to my exams
        </Link>
      </div>
    </div>
  )
}
