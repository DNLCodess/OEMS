import Link from 'next/link'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { BarChart2, Users, CheckCircle2, Clock, AlertTriangle, ArrowRight } from 'lucide-react'

export const metadata = { title: 'Results' }

export default async function LecturerResultsPage() {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()

  const { data: exams } = await supabase
    .from('exams')
    .select('id, title, status, pass_mark, courses!course_id ( course_code, course_title ), exam_questions ( marks )')
    .eq('university_id', user.university_id)
    .eq('created_by', user.id)
    .in('status', ['live', 'closed'])
    .order('created_at', { ascending: false })

  if (!exams?.length) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-8">Results</h1>
        <EmptyState
          icon={BarChart2}
          title="No results yet"
          description="Results appear here once exams go live or close."
          action={
            <Link href="/lecturer/exams" className="inline-flex items-center px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors">
              Go to Exams
            </Link>
          }
        />
      </div>
    )
  }

  const examIds = exams.map(e => e.id)

  const [{ data: attempts }, { data: results }, { data: responses }] = await Promise.all([
    supabase
      .from('attempts')
      .select('id, exam_id, status, total_score, student_id')
      .in('exam_id', examIds)
      .in('status', ['submitted', 'graded']),

    supabase
      .from('results')
      .select('exam_id, student_id, final_score, passed, released_at')
      .in('exam_id', examIds),

    // Check which attempts still have ungraded responses
    supabase
      .from('responses')
      .select('attempt_id')
      .in('attempt_id',
        // We'll use a broad in — empty array guard
        ['00000000-0000-0000-0000-000000000000']
      )
      .is('is_correct', null)
      .limit(1),
  ])

  // Get attempt IDs for ungraded check
  const attemptIds = (attempts ?? []).map(a => a.id)
  const { data: ungradedResponses } = attemptIds.length
    ? await supabase
        .from('responses')
        .select('attempt_id')
        .in('attempt_id', attemptIds)
        .is('is_correct', null)
    : { data: [] }

  const attemptsNeedingReview = new Set((ungradedResponses ?? []).map(r => r.attempt_id))

  // Build per-exam aggregates
  const enriched = exams.map(exam => {
    const totalMarks = (exam.exam_questions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)
    const examAttempts = (attempts ?? []).filter(a => a.exam_id === exam.id)
    const examResults  = (results ?? []).filter(r => r.exam_id === exam.id)

    const submitted = examAttempts.length
    const released  = examResults.filter(r => r.released_at).length
    const unreleased = examResults.length - released
    const passCount  = examResults.filter(r => r.passed).length
    const passRate   = examResults.length > 0 ? Math.round((passCount / examResults.length) * 100) : null

    const scores = examResults.map(r => r.final_score ?? 0)
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
    const maxScore = scores.length > 0 ? Math.max(...scores) : null
    const minScore = scores.length > 0 ? Math.min(...scores) : null

    const needsReviewCount = examAttempts.filter(a => attemptsNeedingReview.has(a.id)).length

    const allReleased = examResults.length > 0 && released === examResults.length

    return {
      ...exam, totalMarks, submitted, released, unreleased,
      passCount, passRate, avgScore, maxScore, minScore,
      needsReviewCount, allReleased, resultCount: examResults.length,
    }
  })

  // Summary across all exams
  const totalSubmissions  = enriched.reduce((s, e) => s + e.submitted, 0)
  const totalPassed       = enriched.reduce((s, e) => s + e.passCount, 0)
  const totalUnreleased   = enriched.reduce((s, e) => s + e.unreleased, 0)
  const totalNeedsReview  = enriched.reduce((s, e) => s + e.needsReviewCount, 0)
  const overallPassRate   = totalSubmissions > 0
    ? Math.round((totalPassed / totalSubmissions) * 100)
    : null

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Results</h1>
        <p className="text-sm text-text-secondary mt-1">
          Overview of all your exams with submissions.
        </p>
      </div>

      {/* Platform summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <SummaryCard label="Total Submissions" value={totalSubmissions} color="neutral" />
        <SummaryCard
          label="Overall Pass Rate"
          value={overallPassRate !== null ? `${overallPassRate}%` : '—'}
          color={overallPassRate !== null ? (overallPassRate >= 60 ? 'success' : 'danger') : 'neutral'}
        />
        <SummaryCard
          label="Awaiting Release"
          value={totalUnreleased}
          color={totalUnreleased > 0 ? 'warning' : 'neutral'}
        />
        <SummaryCard
          label="Need Grading"
          value={totalNeedsReview}
          color={totalNeedsReview > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {/* Alert banners */}
      {(totalNeedsReview > 0 || totalUnreleased > 0) && (
        <div className="space-y-2 mb-6">
          {totalNeedsReview > 0 && (
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <AlertTriangle size={15} className="text-amber-600 shrink-0" />
              <p className="text-sm text-amber-800 flex-1">
                <span className="font-semibold">{totalNeedsReview} submission{totalNeedsReview > 1 ? 's' : ''}</span> have essay or short-answer questions awaiting manual grading.
              </p>
            </div>
          )}
          {totalUnreleased > 0 && (
            <div className="flex items-center gap-3 bg-primary-light border border-primary/20 rounded-xl px-4 py-3">
              <Clock size={15} className="text-primary shrink-0" />
              <p className="text-sm text-primary flex-1">
                <span className="font-semibold">{totalUnreleased} result{totalUnreleased > 1 ? 's' : ''}</span> are graded but not yet released to students.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Exam cards */}
      <div className="grid gap-5">
        {enriched.map(exam => (
          <div key={exam.id} className="bg-surface border border-border rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 p-5 pb-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-mono text-text-muted bg-slate-100 px-2 py-0.5 rounded">
                    {exam.courses?.course_code}
                  </span>
                  <Badge variant={exam.status} />
                  {exam.allReleased && exam.resultCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-success bg-success-light px-2 py-0.5 rounded-full">
                      <CheckCircle2 size={10} /> Released
                    </span>
                  )}
                  {!exam.allReleased && exam.released > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-warning bg-warning-light px-2 py-0.5 rounded-full">
                      <Clock size={10} /> Partially released
                    </span>
                  )}
                  {exam.needsReviewCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-warning bg-amber-50 px-2 py-0.5 rounded-full">
                      <AlertTriangle size={10} /> {exam.needsReviewCount} need review
                    </span>
                  )}
                </div>
                <p className="font-semibold text-text-primary">{exam.title}</p>
                <p className="text-xs text-text-muted mt-0.5">{exam.courses?.course_title} · Pass mark: {exam.pass_mark}% · Total: {exam.totalMarks} marks</p>
              </div>
              {exam.submitted > 0 ? (
                <Link
                  href={`/lecturer/exams/${exam.id}/results`}
                  className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors"
                >
                  <Users size={14} />
                  View Results
                </Link>
              ) : (
                <span className="shrink-0 text-sm text-text-muted">No submissions</span>
              )}
            </div>

            {/* Stats row */}
            {exam.submitted > 0 && (
              <div className="border-t border-border bg-slate-50/60 px-5 py-3 grid grid-cols-2 sm:grid-cols-5 gap-4">
                <Stat label="Submissions"   value={exam.submitted} />
                <Stat
                  label="Pass Rate"
                  value={exam.passRate !== null ? `${exam.passRate}%` : '—'}
                  color={exam.passRate !== null ? (exam.passRate >= 60 ? 'text-success' : 'text-danger') : undefined}
                />
                <Stat label="Avg Score"    value={exam.avgScore !== null ? `${exam.avgScore}/${exam.totalMarks}` : '—'} />
                <Stat label="Highest"      value={exam.maxScore !== null ? `${exam.maxScore}/${exam.totalMarks}` : '—'} color="text-success" />
                <Stat label="Lowest"       value={exam.minScore !== null ? `${exam.minScore}/${exam.totalMarks}` : '—'} color="text-danger" />
              </div>
            )}

            {/* Pass rate bar */}
            {exam.passRate !== null && (
              <div className="px-5 pb-4 pt-2">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-text-muted">{exam.passCount} passed · {exam.resultCount - exam.passCount} failed</span>
                  <span className={`font-semibold ${exam.passRate >= 60 ? 'text-success' : 'text-danger'}`}>{exam.passRate}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full bar-chart-bar ${exam.passRate >= 60 ? 'bg-success' : 'bg-danger'}`}
                    style={{ width: `${exam.passRate}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, color }) {
  const cls = {
    success: 'bg-success-light border-success/20 text-success',
    danger:  'bg-danger-light border-danger/20 text-danger',
    warning: 'bg-amber-50 border-amber-200 text-amber-700',
    neutral: 'bg-surface border-border text-text-primary',
  }[color]
  return (
    <div className={`border rounded-xl p-4 text-center ${cls}`}>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-text-muted mt-0.5">{label}</p>
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div>
      <p className={`text-base font-bold tabular-nums ${color ?? 'text-text-primary'}`}>{value}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  )
}
