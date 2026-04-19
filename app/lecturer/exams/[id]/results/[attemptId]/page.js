import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { GradePanel } from '@/components/lecturer/GradePanel'
import { CheckCircle2, XCircle } from 'lucide-react'

export const metadata = { title: 'Grade Submission' }

export default async function GradeAttemptPage({ params }) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()
  const { id: examId, attemptId } = await params

  // Fetch exam (ownership check)
  const { data: exam } = await supabase
    .from('exams')
    .select('id, title, pass_mark, created_by, courses ( course_code )')
    .eq('id', examId)
    .eq('university_id', user.university_id)
    .single()

  if (!exam || exam.created_by !== user.id) notFound()

  // Fetch attempt + student info
  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, status, submitted_at, total_score, users:student_id ( full_name, matric_number, level )')
    .eq('id', attemptId)
    .eq('exam_id', examId)
    .single()

  if (!attempt || attempt.status === 'in_progress') notFound()

  // Fetch result
  const { data: result } = await supabase
    .from('results')
    .select('final_score, passed, released_at')
    .eq('attempt_id', attemptId)
    .maybeSingle()

  // Fetch exam questions in order
  const { data: examQuestions } = await supabase
    .from('exam_questions')
    .select('question_id, marks, order_index, question_bank:question_id ( type, body, options )')
    .eq('exam_id', examId)
    .order('order_index')

  // Fetch responses for this attempt
  const { data: responses } = await supabase
    .from('responses')
    .select('id, question_id, student_answer, is_correct, marks_awarded, teacher_feedback')
    .eq('attempt_id', attemptId)

  const responseMap = new Map((responses ?? []).map(r => [r.question_id, r]))

  const totalPossible = (examQuestions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)
  const currentScore  = result?.final_score ?? attempt.total_score ?? 0
  const percentage    = totalPossible > 0 ? Math.round((currentScore / totalPossible) * 100) : 0

  // Build question rows for GradePanel
  const questions = (examQuestions ?? []).map((eq, index) => {
    const qb       = eq.question_bank
    const response = responseMap.get(eq.question_id)

    return {
      question_id:     eq.question_id,
      response_id:     response?.id ?? null,
      order_num:       index + 1,
      type:            qb?.type,
      body:            qb?.body,
      options:         qb?.options ?? [],
      question_marks:  eq.marks,
      student_answer:  response?.student_answer ?? null,
      is_correct:      response?.is_correct ?? null,
      marks_awarded:   response?.marks_awarded ?? 0,
      teacher_feedback: response?.teacher_feedback ?? '',
    }
  })

  const needsManualGrading = questions.some(q => q.is_correct === null && q.response_id)

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Back nav */}
      <Link
        href={`/lecturer/exams/${examId}/results`}
        className="text-sm text-text-muted hover:text-primary transition-colors"
      >
        ← Back to Results
      </Link>

      {/* Student + score header */}
      <div className="mt-2 mb-8">
        <h1 className="text-xl font-bold text-text-primary tracking-tight">
          {attempt.users?.full_name}
        </h1>
        {attempt.users?.matric_number && (
          <p className="font-mono text-sm text-text-muted mt-0.5">{attempt.users.matric_number}</p>
        )}
      </div>

      {/* Score summary card */}
      <div className={[
        'rounded-xl border p-5 mb-8 flex items-center justify-between',
        result?.passed === true  ? 'bg-success-light border-success/20' :
        result?.passed === false ? 'bg-danger-light  border-danger/20'  :
        'bg-surface border-border',
      ].join(' ')}>
        <div>
          <p className="text-xs text-text-muted mb-1">
            {exam.courses?.course_code} · {exam.title}
          </p>
          <div className="flex items-center gap-2">
            {result?.passed === true  && <CheckCircle2 size={18} className="text-success" />}
            {result?.passed === false && <XCircle      size={18} className="text-danger"  />}
            <span className="text-2xl font-bold text-text-primary tabular-nums">
              {currentScore}/{totalPossible}
            </span>
            <span className="text-base text-text-secondary">({percentage}%)</span>
            {result?.passed !== null && result?.passed !== undefined && (
              <span className={`text-sm font-semibold ${result.passed ? 'text-success' : 'text-danger'}`}>
                · {result.passed ? 'Pass' : 'Fail'}
              </span>
            )}
          </div>
          {needsManualGrading && (
            <p className="text-xs text-warning mt-1 font-medium">
              Score will update after you save manual grades below.
            </p>
          )}
        </div>
        <div className="text-right text-xs text-text-muted">
          <p>Pass mark: {exam.pass_mark}%</p>
          {result?.released_at && <p className="text-success mt-0.5">Result released</p>}
        </div>
      </div>

      {/* Grade panel */}
      <h2 className="text-base font-semibold text-text-primary mb-4">Question Responses</h2>
      <GradePanel
        examId={examId}
        attemptId={attemptId}
        questions={questions}
      />
    </div>
  )
}
