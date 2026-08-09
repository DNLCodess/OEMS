import Link from 'next/link'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { EmptyState } from '@/components/ui/EmptyState'
import { CheckCircle2, XCircle, BarChart2, TrendingUp, TrendingDown, Minus, BookOpen } from 'lucide-react'
import { format } from 'date-fns'

export const metadata = { title: 'My Results' }

export default async function StudentResultsPage() {
  const user     = await requireRole('student')
  const supabase = await createClient()

  const { data: results } = await supabase
    .from('results')
    .select(`
      final_score, passed,
      exams:exam_id (
        id, title, pass_mark, exam_type,
        courses!course_id ( course_code, course_title ),
        exam_questions ( marks )
      ),
      attempts:attempt_id ( submitted_at )
    `)
    .eq('student_id', user.id)
    .order('attempts(submitted_at)', { ascending: false })

  if (!results?.length) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-8">My Results</h1>
        <EmptyState
          icon={BarChart2}
          title="No results yet"
          description="Your results will appear here as soon as you complete an exam."
          action={
            <Link href="/student/exams" className="inline-flex items-center px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors">
              View My Exams
            </Link>
          }
        />
      </div>
    )
  }

  const enriched = results.map(r => {
    const exam       = r.exams
    const totalMarks = (exam?.exam_questions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)
    const pct        = totalMarks > 0 ? Math.round((r.final_score / totalMarks) * 100) : 0
    return { ...r, exam, totalMarks, pct }
  })

  const total   = enriched.length
  const passed  = enriched.filter(r => r.passed).length
  const avgPct  = Math.round(enriched.reduce((s, r) => s + r.pct, 0) / total)

  // Trend: compare most recent 3 vs previous 3
  const last3    = enriched.slice(0, 3)
  const prev3    = enriched.slice(3, 6)
  const avg3     = arr => arr.length ? Math.round(arr.reduce((s, r) => s + r.pct, 0) / arr.length) : null
  const trendNow = avg3(last3)
  const trendPrev= avg3(prev3)
  const trend    = trendNow !== null && trendPrev !== null
    ? trendNow > trendPrev + 3 ? 'up' : trendNow < trendPrev - 3 ? 'down' : 'steady'
    : null

  // Group by course
  const courseMap = {}
  for (const r of enriched) {
    const code = r.exam?.courses?.course_code ?? 'Unknown'
    if (!courseMap[code]) courseMap[code] = {
      code,
      title: r.exam?.courses?.course_title ?? '',
      results: [],
    }
    courseMap[code].results.push(r)
  }
  const courses = Object.values(courseMap).map(c => {
    const avgPct = Math.round(c.results.reduce((s, r) => s + r.pct, 0) / c.results.length)
    const passed = c.results.filter(r => r.passed).length
    return { ...c, avgPct, passed }
  }).sort((a, b) => a.avgPct - b.avgPct)

  const EXAM_TYPE_LABEL = { ca: 'C.A.', mid_semester: 'Mid-Semester', end_of_semester: 'End of Semester' }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">My Results</h1>
        <p className="text-sm text-text-secondary mt-1">
          {total} result{total !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <SummaryCard label="Total Exams"   value={total}           color="neutral" />
        <SummaryCard label="Passed"        value={passed}          color="success" />
        <SummaryCard label="Failed"        value={total - passed}  color="danger" />
        <SummaryCard label="Average Score" value={`${avgPct}%`}    color={avgPct >= 70 ? 'success' : avgPct >= 50 ? 'warning' : 'danger'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main: results list */}
        <div className="lg:col-span-2 space-y-4">
          {enriched.map((r, i) => (
            <div
              key={i}
              className={`bg-surface border rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4 ${
                r.passed ? 'border-success/20' : 'border-danger/20'
              }`}
            >
              {/* Score donut-style indicator */}
              <div className="shrink-0 flex flex-col items-center w-16">
                <div className={`text-2xl font-bold tabular-nums ${r.passed ? 'text-success' : 'text-danger'}`}>
                  {r.pct}%
                </div>
                {r.passed
                  ? <CheckCircle2 size={16} className="text-success mt-0.5" />
                  : <XCircle     size={16} className="text-danger mt-0.5"  />
                }
              </div>

              {/* Exam info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-xs font-mono text-text-muted bg-slate-100 px-2 py-0.5 rounded">
                    {r.exam?.courses?.course_code}
                  </span>
                  {r.exam?.exam_type && (
                    <span className="text-xs text-text-muted">
                      {EXAM_TYPE_LABEL[r.exam.exam_type] ?? r.exam.exam_type}
                    </span>
                  )}
                  <span className={`text-xs font-semibold ${r.passed ? 'text-success' : 'text-danger'}`}>
                    {r.passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>
                <p className="text-sm font-semibold text-text-primary truncate">{r.exam?.title}</p>
                <p className="text-xs text-text-muted mt-0.5">{r.exam?.courses?.course_title}</p>

                {/* Score progress bar */}
                <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full bar-chart-bar ${r.passed ? 'bg-success' : 'bg-danger'}`}
                    style={{ width: `${r.pct}%` }}
                  />
                </div>
              </div>

              {/* Score + detail */}
              <div className="shrink-0 text-right space-y-1">
                <p className="text-xl font-bold text-text-primary tabular-nums">
                  {r.final_score}<span className="text-sm text-text-muted">/{r.totalMarks}</span>
                </p>
                <p className="text-xs text-text-muted">Pass mark: {r.exam?.pass_mark}%</p>
                {r.attempts?.submitted_at && (
                  <p className="text-xs text-text-muted">
                    {format(new Date(r.attempts.submitted_at), 'MMM d, yyyy')}
                  </p>
                )}
                <Link
                  href={`/student/exams/${r.exam?.id}/result`}
                  className="inline-block px-3 py-1 border border-border text-xs font-medium text-text-secondary rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Details →
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/* Sidebar: course breakdown + trend */}
        <div className="space-y-5">
          {/* Trend card */}
          {trend && (
            <div className={`rounded-xl border p-5 ${
              trend === 'up' ? 'bg-success-light border-success/20' :
              trend === 'down' ? 'bg-danger-light border-danger/20' :
              'bg-surface border-border'
            }`}>
              <div className="flex items-center gap-2 mb-1">
                {trend === 'up'     && <TrendingUp   size={18} className="text-success" />}
                {trend === 'down'   && <TrendingDown size={18} className="text-danger"  />}
                {trend === 'steady' && <Minus        size={18} className="text-primary" />}
                <span className={`text-sm font-semibold ${
                  trend === 'up' ? 'text-success' : trend === 'down' ? 'text-danger' : 'text-primary'
                }`}>
                  {trend === 'up' ? 'Improving' : trend === 'down' ? 'Declining' : 'Steady'}
                </span>
              </div>
              <p className="text-xs text-text-muted">
                {trend === 'up'     && `Recent avg ${trendNow}% vs previous ${trendPrev}%`}
                {trend === 'down'   && `Recent avg ${trendNow}% vs previous ${trendPrev}%`}
                {trend === 'steady' && `Consistent around ${trendNow}%`}
              </p>
            </div>
          )}

          {/* Course performance */}
          <div className="bg-surface border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <BookOpen size={15} className="text-text-muted" />
              <h2 className="text-sm font-semibold text-text-primary">By Course</h2>
            </div>
            <div className="space-y-4">
              {courses.map(c => (
                <div key={c.code}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-mono font-medium text-text-primary">{c.code}</span>
                    <span className={`font-semibold ${
                      c.avgPct >= 70 ? 'text-success' : c.avgPct >= 50 ? 'text-warning' : 'text-danger'
                    }`}>
                      {c.avgPct}%
                    </span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full bar-chart-bar ${
                        c.avgPct >= 70 ? 'bg-success' : c.avgPct >= 50 ? 'bg-amber-400' : 'bg-danger'
                      }`}
                      style={{ width: `${c.avgPct}%` }}
                    />
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    {c.passed}/{c.results.length} passed
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
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
