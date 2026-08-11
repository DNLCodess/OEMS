import { notFound, redirect } from 'next/navigation'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { ExamInterface } from '@/components/student/ExamInterface'
import { submitExam } from '@/lib/actions/attempts'

export const metadata = { title: 'Exam — OEMS Lab' }

export default async function LabAttemptPage({ params }) {
  const user     = await requireRole('student')
  const supabase = await createClient()
  const { code, attemptId } = await params

  // Resolve exam from lab code
  const { data: exam } = await supabase
    .from('exams')
    .select(`
      id, title, status, duration_minutes, pass_mark,
      randomise_questions, randomise_options,
      show_calculator, tips, proctoring_enabled, access_code
    `)
    .eq('access_code', code.toUpperCase())
    .single()

  if (!exam) notFound()

  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, exam_id, status, started_at, student_id')
    .eq('id', attemptId)
    .eq('student_id', user.id)
    .single()

  if (!attempt) notFound()

  if (attempt.status !== 'in_progress') {
    redirect(`/lab/${code}`)
  }

  if (exam.status !== 'live') {
    // The lecturer closed the exam (or otherwise moved it off 'live') while
    // this student was still mid-attempt. WorkflowPanel's own confirmation
    // text already promises that closing "stops all ongoing attempts" —
    // this is what actually makes that true, instead of just silently
    // bouncing the student back to the lobby with their attempt stuck
    // in_progress forever and no result. submitExam runs in this same
    // student's own request context (same session cookies), so its own
    // requireRole('student') + student_id ownership check resolve exactly
    // as they would if the student had clicked Submit themselves.
    await submitExam(attempt.id)
    redirect(`/lab/${code}/result`)
  }

  const { data: rawQuestions } = await supabase
    .from('exam_questions')
    .select(`
      id, question_id, order_index, marks,
      question_bank:question_id ( id, type, body, options, difficulty )
    `)
    .eq('exam_id', exam.id)
    .order('order_index')

  let questions = (rawQuestions ?? []).map(eq => ({
    id:          eq.id,
    question_id: eq.question_id,
    order_index: eq.order_index,
    marks:       eq.marks,
    ...eq.question_bank,
  }))

  if (exam.randomise_questions) {
    const seed = parseInt(attemptId.replace(/-/g, '').slice(0, 8), 16)
    questions = deterministicShuffle(questions, seed)
  }

  const { data: responses } = await supabase
    .from('responses')
    .select('question_id, student_answer')
    .eq('attempt_id', attemptId)

  return (
    <ExamInterface
      exam={exam}
      questions={questions}
      attemptId={attemptId}
      studentId={user.id}
      startedAt={attempt.started_at}
      responses={responses ?? []}
      labMode
      labCode={code}
    />
  )
}

function deterministicShuffle(arr, seed) {
  const result = [...arr]
  let s = seed
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    const j = Math.abs(s) % (i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
