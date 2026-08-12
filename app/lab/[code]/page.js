import { notFound, redirect } from 'next/navigation'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MatricEntryForm } from './MatricEntryForm'
import { LabStartButton } from './LabStartButton'
import { EndSessionButton } from './EndSessionButton'
import { Clock, BookOpen, FileText, Monitor } from 'lucide-react'

export const metadata = { title: 'Exam — OEMS Lab' }

export default async function LabLobbyPage({ params }) {
  const { code } = await params
  const upperCode = code.toUpperCase()

  // A lab machine can be pre-loaded to this URL before anyone has entered a
  // matric number — an unauthenticated visitor has no RLS-visible session,
  // so this initial lookup must use the admin client, the same way
  // verifyExamAccess does. Only the exam's existence is checked here;
  // nothing sensitive (instructions, questions, status detail) is exposed
  // before authentication.
  const adminClient = createAdminClient()
  const { data: examBasic, error: examBasicError } = await adminClient
    .from('exams')
    .select('id')
    .eq('access_code', upperCode)
    .maybeSingle()

  if (examBasicError) {
    console.error('[LabLobbyPage]', examBasicError)
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-sm text-text-muted">Failed to load this exam. Please refresh.</p>
      </div>
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
    )
  }

  // Authenticated for this specific exam — requireRole re-confirms the
  // role/active-account guard (redirects to /login if that somehow doesn't
  // hold), then everything below is unchanged from before this task.
  const user = await requireRole('student')

  const { data: exam, error: examError } = await supabase
    .from('exams')
    .select(`
      id, title, status, exam_type, academic_session, semester,
      duration_minutes, pass_mark, instructions,
      show_calculator, tips,
      courses!course_id ( course_code, course_title )
    `)
    .eq('access_code', upperCode)
    .single()

  if (examError) {
    console.error('[LabLobbyPage]', examError)
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-sm text-text-muted">Failed to load this exam. Please refresh.</p>
      </div>
    )
  }

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
  const { data: attempt, error: attemptError } = await supabase
    .from('attempts')
    .select('id, status')
    .eq('exam_id', exam.id)
    .eq('student_id', user.id)
    .maybeSingle()
  // A failure here just means the "Start Exam" CTA shows instead of an
  // automatic redirect — startExam() independently re-checks for an
  // in-progress attempt and resumes it, so there's no correctness impact.
  if (attemptError) console.error('[LabLobbyPage]', attemptError)

  if (attempt?.status === 'in_progress') {
    redirect(`/lab/${upperCode}/attempt/${attempt.id}`)
  }

  const { data: examQuestions, error: examQuestionsError } = await supabase
    .from('exam_questions')
    .select('marks')
    .eq('exam_id', exam.id)
  if (examQuestionsError) console.error('[LabLobbyPage]', examQuestionsError)

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
            Lab Session · Code: {upperCode}
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
          {!examQuestionsError && (
            <div className="bg-surface border border-border rounded-xl p-4 text-center">
              <BookOpen size={20} className="mx-auto mb-2 text-text-muted" />
              <p className="text-2xl font-bold text-text-primary">{questionCount}</p>
              <p className="text-xs text-text-muted mt-0.5">questions</p>
            </div>
          )}
          {!examQuestionsError && (
            <div className="bg-surface border border-border rounded-xl p-4 text-center">
              <FileText size={20} className="mx-auto mb-2 text-text-muted" />
              <p className="text-2xl font-bold text-text-primary">{totalMarks}</p>
              <p className="text-xs text-text-muted mt-0.5">marks · pass {exam.pass_mark}%</p>
            </div>
          )}
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
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">You have already submitted this exam.</p>
              <div className="flex items-center justify-center gap-3">
                <a
                  href={`/lab/${upperCode}/result`}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-primary rounded-xl hover:bg-primary-hover transition-colors"
                >
                  View my result
                </a>
                <EndSessionButton code={upperCode} />
              </div>
            </div>
          ) : (
            <LabStartButton examId={exam.id} labCode={upperCode} />
          )}
        </div>
      </div>
    </div>
  )
}
