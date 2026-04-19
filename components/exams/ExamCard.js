import Link from 'next/link'
import { Clock, BookOpen, FileText, Calendar } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { EXAM_TYPE_LABELS } from '@/lib/utils'

const STATUS_DOT = {
  draft:     'bg-slate-400',
  scheduled: 'bg-primary',
  live:      'bg-success animate-pulse',
  closed:    'bg-slate-300',
}

export function ExamCard({ exam }) {
  const {
    id, title, status, exam_type, academic_session, semester,
    duration_minutes, course_code, question_count = 0, total_marks = 0,
  } = exam

  return (
    <Link
      href={`/lecturer/exams/${id}`}
      className="block bg-surface border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-sm transition-all group"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-base font-semibold text-text-primary group-hover:text-primary transition-colors leading-snug">
          {title}
        </h3>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status] ?? 'bg-slate-300'}`} />
          <Badge variant={status} />
        </div>
      </div>

      {/* Course + Type */}
      <div className="flex items-center gap-2 mb-4">
        <span className="font-mono text-xs font-medium text-primary bg-primary-light px-2 py-0.5 rounded">
          {course_code}
        </span>
        <span className="text-xs text-text-muted">·</span>
        <span className="text-xs text-text-secondary">{EXAM_TYPE_LABELS[exam_type] ?? exam_type}</span>
      </div>

      {/* Meta row */}
      <div className="flex items-center flex-wrap gap-x-4 gap-y-2 text-xs text-text-muted">
        <span className="flex items-center gap-1">
          <Calendar size={12} />
          {academic_session} · {semester === 'first' ? '1st' : '2nd'} Semester
        </span>
        <span className="flex items-center gap-1">
          <Clock size={12} />
          {duration_minutes} min
        </span>
        <span className="flex items-center gap-1">
          <BookOpen size={12} />
          {question_count} {question_count === 1 ? 'question' : 'questions'}
        </span>
        <span className="flex items-center gap-1">
          <FileText size={12} />
          {total_marks} marks
        </span>
      </div>
    </Link>
  )
}
