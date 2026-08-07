import { notFound, redirect } from 'next/navigation'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { LabStartButton } from './LabStartButton'
import { Clock, BookOpen, FileText, Monitor } from 'lucide-react'

export const metadata = { title: 'Exam — OEMS Lab' }

export default async function LabLobbyPage({ params }) {
  const user     = await requireRole('student')
  const supabase = await createClient()
  const { code } = await params

  // Look up exam by lab code
  const { data: exam } = await supabase
    .from('exams')
    .select(`
      id, title, status, exam_type, academic_session, semester,
      duration_minutes, pass_mark, instructions,
      show_calculator, tips,
      courses!course_id ( course_code, course_title )
    `)
    .eq('access_code', code.toUpperCase())
    .single()

  if (!exam) notFound()

  // Must be live
  if (exam.status !== 'live') {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <Monitor size={48} className="mx-auto mb-4 text-text-muted" />
          <h1 className="text-xl font-bold text-text-primary mb-2">Exam not active</h1>
          <p className="text-sm text-text-muted">
            This exam is currently <strong>{exam.status}</strong>. Wait for your lecturer to open it.
          </p>
        </div>
      </div>
    )
  }

  // Check for existing attempt
  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, status')
    .eq('exam_id', exam.id)
    .eq('student_id', user.id)
    .maybeSingle()

  if (attempt?.status === 'in_progress') {
    redirect(`/lab/${code}/attempt/${attempt.id}`)
  }

  const { data: examQuestions } = await supabase
    .from('exam_questions')
    .select('marks')
    .eq('exam_id', exam.id)

  const questionCount = examQuestions?.length ?? 0
  const totalMarks    = (examQuestions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)
  const alreadyDone   = attempt && attempt.status !== 'in_progress'

  const EXAM_TYPE_LABELS = {
    ca: 'Continuous Assessment', mid_semester: 'Mid-Semester Test', end_of_semester: 'End of Semester Examination',
  }

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-xl">
        {/* Lab badge */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="flex items-center gap-1.5 bg-primary text-white text-xs font-semibold px-3 py-1.5 rounded-full">
            <Monitor size={12} />
            Lab Session · Code: {code.toUpperCase()}
          </span>
        </div>

        {/* Exam header */}
        <div className="text-center mb-8">
          <p className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">
            {exam.courses?.course_code} · {EXAM_TYPE_LABELS[exam.exam_type] ?? exam.exam_type}
          </p>
          <h1 className="text-3xl font-bold text-text-primary tracking-tight mb-1">{exam.title}</h1>
          <p className="text-sm text-text-secondary">
            {exam.academic_session} · {exam.semester === 'first' ? 'First' : 'Second'} Semester
          </p>
          {user.matric_number && (
            <p className="font-mono text-xs text-text-muted mt-2">
              {user.matric_number} · {user.full_name}
            </p>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
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
            <p className="text-xs text-text-muted mt-0.5">marks · pass {exam.pass_mark}%</p>
          </div>
        </div>

        {/* Instructions */}
        {exam.instructions && (
          <div className="bg-surface border border-border rounded-xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-text-primary mb-2">Instructions</h2>
            <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">
              {exam.instructions}
            </p>
          </div>
        )}

        {/* CTA */}
        <div className="text-center">
          {alreadyDone ? (
            <p className="text-sm text-text-secondary">You have already submitted this exam.</p>
          ) : (
            <LabStartButton examId={exam.id} labCode={code} />
          )}
        </div>
      </div>
    </div>
  )
}
