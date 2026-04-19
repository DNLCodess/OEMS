import Link from 'next/link'
import { Clock, BookOpen, CalendarCheck } from 'lucide-react'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata = { title: 'My Exams' }

const EXAM_TYPE_LABELS = {
  ca:              'C.A.',
  mid_semester:    'Mid-Semester',
  end_of_semester: 'End of Semester',
}

export default async function StudentExamsPage() {
  const user     = await requireRole('student')
  const supabase = await createClient()

  // Fetch accessible exams (RLS enforces access rules)
  const { data: exams } = await supabase
    .from('exams')
    .select(`
      id, title, status, exam_type, academic_session, semester,
      duration_minutes,
      courses ( course_code, course_title )
    `)
    .eq('university_id', user.university_id)
    .in('status', ['scheduled', 'live', 'closed'])
    .order('created_at', { ascending: false })

  // Fetch this student's attempts for those exams
  const examIds = (exams ?? []).map(e => e.id)
  const { data: attempts } = examIds.length
    ? await supabase
        .from('attempts')
        .select('exam_id, id, status')
        .eq('student_id', user.id)
        .in('exam_id', examIds)
    : { data: [] }

  // Fetch released results
  const { data: results } = examIds.length
    ? await supabase
        .from('results')
        .select('exam_id, final_score, passed, released_at')
        .eq('student_id', user.id)
        .in('exam_id', examIds)
        .not('released_at', 'is', null)
    : { data: [] }

  const attemptMap = new Map((attempts ?? []).map(a => [a.exam_id, a]))
  const resultMap  = new Map((results  ?? []).map(r => [r.exam_id, r]))

  const liveExams      = (exams ?? []).filter(e => e.status === 'live')
  const scheduledExams = (exams ?? []).filter(e => e.status === 'scheduled')
  const closedExams    = (exams ?? []).filter(e => e.status === 'closed')

  function ExamRow({ exam }) {
    const attempt = attemptMap.get(exam.id)
    const result  = resultMap.get(exam.id)

    let action
    if (exam.status === 'live') {
      if (!attempt) {
        action = (
          <Link
            href={`/student/exams/${exam.id}`}
            className="px-4 py-1.5 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary-hover transition-colors"
          >
            Start Exam
          </Link>
        )
      } else if (attempt.status === 'in_progress') {
        action = (
          <Link
            href={`/student/exams/${exam.id}/attempt/${attempt.id}`}
            className="px-4 py-1.5 bg-warning text-white text-xs font-medium rounded-lg hover:bg-amber-700 transition-colors"
          >
            Resume
          </Link>
        )
      } else {
        action = <span className="text-xs text-text-muted">Submitted</span>
      }
    } else if (exam.status === 'scheduled') {
      action = <span className="text-xs text-text-muted">Not yet open</span>
    } else if (exam.status === 'closed') {
      if (result) {
        action = (
          <Link
            href={`/student/exams/${exam.id}/result`}
            className="px-4 py-1.5 bg-surface border border-border text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors"
          >
            View Result
          </Link>
        )
      } else if (attempt) {
        action = <span className="text-xs text-text-muted">Awaiting results</span>
      } else {
        action = <span className="text-xs text-text-muted">Missed</span>
      }
    }

    return (
      <div className="flex items-center gap-4 bg-surface border border-border rounded-xl px-5 py-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono text-xs text-primary font-medium">
              {exam.courses?.course_code}
            </span>
            <span className="text-xs text-text-muted">·</span>
            <span className="text-xs text-text-muted">{EXAM_TYPE_LABELS[exam.exam_type]}</span>
          </div>
          <p className="text-sm font-semibold text-text-primary truncate">{exam.title}</p>
          <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
            <span className="flex items-center gap-1"><Clock size={11} />{exam.duration_minutes} min</span>
            <span>{exam.academic_session}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {result && (
            <span className={`text-xs font-semibold ${result.passed ? 'text-success' : 'text-danger'}`}>
              {result.final_score} pts · {result.passed ? 'Pass' : 'Fail'}
            </span>
          )}
          <Badge variant={exam.status} />
          {action}
        </div>
      </div>
    )
  }

  const hasAny = (exams ?? []).length > 0

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">My Exams</h1>
        <p className="text-sm text-text-secondary mt-1">All exams available to you this session.</p>
      </div>

      {!hasAny ? (
        <EmptyState
          icon={CalendarCheck}
          title="No exams yet"
          description="Your lecturers haven't opened any exams for you yet. Check back soon."
        />
      ) : (
        <div className="space-y-8">
          {liveExams.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
                Live Now
              </h2>
              <div className="space-y-2">
                {liveExams.map(e => <ExamRow key={e.id} exam={e} />)}
              </div>
            </section>
          )}

          {scheduledExams.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
                Upcoming
              </h2>
              <div className="space-y-2">
                {scheduledExams.map(e => <ExamRow key={e.id} exam={e} />)}
              </div>
            </section>
          )}

          {closedExams.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
                Closed
              </h2>
              <div className="space-y-2">
                {closedExams.map(e => <ExamRow key={e.id} exam={e} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
