import { notFound, redirect } from 'next/navigation'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { ExamInterface } from '@/components/student/ExamInterface'

export const metadata = { title: 'Exam' }

export default async function AttemptPage({ params }) {
  const user     = await requireRole('student')
  const supabase = await createClient()
  const { id: examId, attemptId } = await params

  const [{ data: attempt }, { data: exam }] = await Promise.all([
    supabase
      .from('attempts')
      .select('id, exam_id, status, started_at, student_id')
      .eq('id', attemptId)
      .eq('student_id', user.id)
      .single(),

    supabase
      .from('exams')
      .select(`
        id, title, status, duration_minutes, pass_mark,
        randomise_questions, randomise_options,
        show_calculator, tips, proctoring_enabled
      `)
      .eq('id', examId)
      .eq('university_id', user.university_id)
      .single(),
  ])

  if (!attempt || !exam) notFound()

  // Guard: redirect completed attempts to result page
  if (attempt.status !== 'in_progress') {
    redirect(`/student/exams/${examId}/result`)
  }

  // Guard: exam must still be live
  if (exam.status !== 'live') {
    redirect(`/student/exams/${examId}`)
  }

  // Fetch exam questions — NEVER include correct_answer in student context
  const { data: rawQuestions } = await supabase
    .from('exam_questions')
    .select(`
      id, question_id, order_index, marks,
      question_bank:question_id ( id, type, body, options, difficulty )
    `)
    .eq('exam_id', examId)
    .order('order_index')

  // Randomise question order if enabled (per-student, based on attempt id as seed)
  let questions = (rawQuestions ?? []).map(eq => ({
    id:          eq.id,
    question_id: eq.question_id,
    order_index: eq.order_index,
    marks:       eq.marks,
    ...eq.question_bank,
  }))

  if (exam.randomise_questions) {
    // Deterministic shuffle using attempt id so page refreshes keep same order
    const seed = parseInt(attemptId.replace(/-/g, '').slice(0, 8), 16)
    questions = deterministicShuffle(questions, seed)
  }

  // Fetch existing responses (resume support)
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
    />
  )
}

// Deterministic Fisher-Yates using a simple LCG seeded by attempt id
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
