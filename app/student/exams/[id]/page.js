import { notFound, redirect } from 'next/navigation'
import { Clock, BookOpen, FileText, AlertTriangle, Camera, Calculator, Lightbulb } from 'lucide-react'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { StartExamButton } from '@/app/student/exams/[id]/StartExamButton'

export const metadata = { title: 'Exam Lobby' }

const EXAM_TYPE_LABELS = {
  ca:              'Continuous Assessment',
  mid_semester:    'Mid-Semester Test',
  end_of_semester: 'End of Semester Examination',
}

export default async function ExamLobbyPage({ params }) {
  const user     = await requireRole('student')
  const supabase = await createClient()
  const { id }   = await params

  const [{ data: exam }, { data: examQuestions }, { data: attempt }] = await Promise.all([
    supabase
      .from('exams')
      .select(`
        id, title, status, exam_type, academic_session, semester,
        duration_minutes, pass_mark, instructions,
        show_calculator, tips, proctoring_enabled,
        courses!course_id ( course_code, course_title )
      `)
      .eq('id', id)
      .eq('university_id', user.university_id)
      .single(),

    supabase
      .from('exam_questions')
      .select('marks')
      .eq('exam_id', id),

    supabase
      .from('attempts')
      .select('id, status')
      .eq('exam_id', id)
      .eq('student_id', user.id)
      .maybeSingle(),
  ])

  if (!exam) notFound()

  // Redirect in-progress attempt directly to the exam
  if (attempt?.status === 'in_progress') {
    redirect(`/student/exams/${id}/attempt/${attempt.id}`)
  }

  const questionCount = examQuestions?.length ?? 0
  const totalMarks    = (examQuestions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)
  const isLive        = exam.status === 'live'
  const alreadyDone   = attempt && attempt.status !== 'in_progress'

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      {/* Course + type */}
      <p className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">
        {exam.courses?.course_code} · {EXAM_TYPE_LABELS[exam.exam_type] ?? exam.exam_type}
      </p>

      <h1 className="text-3xl font-bold text-text-primary tracking-tight mb-1">{exam.title}</h1>
      <p className="text-sm text-text-secondary mb-8">
        {exam.academic_session} · {exam.semester === 'first' ? 'First' : 'Second'} Semester
      </p>

      {/* Stats card */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-surface border border-border rounded-xl p-4 text-center">
          <Clock size={20} className="mx-auto mb-2 text-text-muted" />
          <p className="text-2xl font-bold text-text-primary">{exam.duration_minutes}</p>
          <p className="text-xs text-text-muted mt-0.5">minutes</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4 text-center">
          <BookOpen size={20} className="mx-auto mb-2 text-text-muted" />
          <p className="text-2xl font-bold text-text-primary">{questionCount}</p>
          <p className="text-xs text-text-muted mt-0.5">questions</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4 text-center">
          <FileText size={20} className="mx-auto mb-2 text-text-muted" />
          <p className="text-2xl font-bold text-text-primary">{totalMarks}</p>
          <p className="text-xs text-text-muted mt-0.5">total marks · pass {exam.pass_mark}%</p>
        </div>
      </div>

      {/* Instructions */}
      {exam.instructions && (
        <div className="bg-surface border border-border rounded-xl p-5 mb-8">
          <h2 className="text-sm font-semibold text-text-primary mb-2">Instructions</h2>
          <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">
            {exam.instructions}
          </p>
        </div>
      )}

      {/* Tools available in this exam */}
      {(exam.show_calculator || exam.tips?.length > 0) && (
        <div className="bg-primary-light border border-primary/20 rounded-xl p-4 mb-4">
          <p className="text-sm font-medium text-primary mb-2">Available during this exam</p>
          <div className="flex flex-wrap gap-3">
            {exam.show_calculator && (
              <span className="flex items-center gap-1.5 text-xs text-primary">
                <Calculator size={13} /> Scientific calculator
              </span>
            )}
            {exam.tips?.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-primary">
                <Lightbulb size={13} /> {exam.tips.length} exam tip{exam.tips.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Proctoring warning */}
      {exam.proctoring_enabled && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <div className="flex items-start gap-2.5">
            <Camera size={15} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-amber-800 mb-0.5">Webcam monitoring enabled</p>
              <p className="text-amber-700 text-xs leading-relaxed">
                Your lecturer has enabled proctoring for this exam. Your webcam will be activated when you start, and random photos will be taken at irregular intervals during the exam. By starting, you consent to this monitoring.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* General exam guidance */}
      <div className="bg-warning-light border border-warning/20 rounded-xl p-4 mb-8">
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-warning mt-0.5 shrink-0" />
          <div className="text-sm text-text-secondary space-y-1">
            <p className="font-medium text-text-primary">Before you start</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li>Ensure you have a stable internet connection.</li>
              <li>Do not close this tab or navigate away during the exam.</li>
              <li>Your answers are saved automatically as you type.</li>
              <li>The exam will auto-submit when the timer reaches zero.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="text-center">
        {alreadyDone ? (
          <div className="text-sm text-text-secondary">
            You have already submitted this exam.{' '}
            <a href={`/student/exams/${id}/result`} className="text-primary hover:underline">
              View your result →
            </a>
          </div>
        ) : !isLive ? (
          <div className="text-sm text-text-muted">
            This exam is not currently open.
          </div>
        ) : (
          <StartExamButton examId={id} />
        )}
      </div>
    </div>
  )
}
