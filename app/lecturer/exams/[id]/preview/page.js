import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Clock, BookOpen, AlertCircle } from 'lucide-react'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { ExamBuilder } from '@/components/exams/ExamBuilder'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'

export const metadata = { title: 'Exam Preview' }

const EXAM_TYPE_LABELS = {
  ca:              'Continuous Assessment',
  mid_semester:    'Mid-Semester Test',
  end_of_semester: 'End of Semester Examination',
}

export default async function ExamPreviewPage({ params }) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()
  const { id }   = await params

  const [{ data: exam }, { data: examQuestions }] = await Promise.all([
    supabase
      .from('exams')
      .select(`
        id, title, status, exam_type, academic_session, semester,
        duration_minutes, pass_mark, instructions, created_by,
        courses ( course_code, course_title )
      `)
      .eq('id', id)
      .eq('university_id', user.university_id)
      .single(),

    supabase
      .from('exam_questions')
      .select(`
        id, exam_id, question_id, order_index, marks,
        question_bank:question_id (
          id, type, body, difficulty, options, correct_answer, course_id,
          courses:course_id ( course_code )
        )
      `)
      .eq('exam_id', id)
      .order('order_index'),
  ])

  if (!exam || exam.created_by !== user.id) notFound()

  const totalMarks = (examQuestions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Back nav */}
      <div className="flex items-center justify-between mb-6">
        <Link
          href={`/lecturer/exams/${id}`}
          className="text-sm text-text-muted hover:text-primary transition-colors"
        >
          ← Back to Exam
        </Link>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-warning-light text-warning text-xs font-medium">
          <AlertCircle size={12} />
          Lecturer preview — not the live student view
        </span>
      </div>

      {/* Exam lobby card (what students see before starting) */}
      <div className="bg-surface border border-border rounded-2xl p-8 mb-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <p className="text-xs font-mono text-text-muted uppercase tracking-wide mb-1">
              {exam.courses?.course_code} · {EXAM_TYPE_LABELS[exam.exam_type] ?? exam.exam_type}
            </p>
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">{exam.title}</h1>
            <p className="text-sm text-text-secondary mt-1">
              {exam.academic_session} · {exam.semester === 'first' ? 'First' : 'Second'} Semester
            </p>
          </div>
          <Badge variant={exam.status} />
        </div>

        {/* Key stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-page rounded-xl p-4 text-center">
            <Clock size={18} className="mx-auto mb-1 text-text-muted" />
            <p className="text-xl font-bold text-text-primary">{exam.duration_minutes}</p>
            <p className="text-xs text-text-muted">minutes</p>
          </div>
          <div className="bg-page rounded-xl p-4 text-center">
            <BookOpen size={18} className="mx-auto mb-1 text-text-muted" />
            <p className="text-xl font-bold text-text-primary">{examQuestions?.length ?? 0}</p>
            <p className="text-xs text-text-muted">questions</p>
          </div>
          <div className="bg-page rounded-xl p-4 text-center">
            <span className="block text-xs text-text-muted mb-1">Total marks</span>
            <p className="text-xl font-bold text-text-primary">{totalMarks}</p>
            <p className="text-xs text-text-muted">pass at {exam.pass_mark}%</p>
          </div>
        </div>

        {/* Instructions */}
        {exam.instructions && (
          <div className="border border-border rounded-xl p-4">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Instructions</p>
            <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">
              {exam.instructions}
            </p>
          </div>
        )}
      </div>

      {/* Question list preview */}
      <div className="mb-4">
        <h2 className="text-base font-semibold text-text-primary">Questions</h2>
        <p className="text-sm text-text-muted mt-0.5">
          Marks are shown. Correct answers are hidden in the student view.
        </p>
      </div>

      <ExamBuilder
        examId={id}
        initialQuestions={examQuestions ?? []}
        bankQuestions={[]}
        readOnly={true}
      />

      {/* CTA */}
      <div className="mt-8 flex justify-end">
        <Link href={`/lecturer/exams/${id}`}>
          <Button>Back to Builder</Button>
        </Link>
      </div>
    </div>
  )
}
