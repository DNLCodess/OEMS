import Link from 'next/link'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import {
  FileQuestion, ScrollText, Users, BarChart2, ArrowRight,
  CheckCircle2, Plus, Eye, BookOpen,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { formatDistanceToNow } from 'date-fns'

export const metadata = { title: 'Dashboard' }

export default async function LecturerDashboardPage() {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()
  const now      = new Date().toISOString()

  const [
    { count: questionCount },
    { data: myExams },
    { data: allResults },
  ] = await Promise.all([
    supabase
      .from('question_bank')
      .select('id', { count: 'exact', head: true })
      .eq('university_id', user.university_id)
      .eq('created_by', user.id)
      .eq('is_archived', false),

    // All my exams with question marks
    supabase
      .from('exams')
      .select('id, title, status, pass_mark, start_at, end_at, courses!course_id ( course_code ), exam_questions ( marks )')
      .eq('university_id', user.university_id)
      .eq('created_by', user.id)
      .order('created_at', { ascending: false }),

    // Results for my exams (student perf data)
    supabase
      .from('results')
      .select('exam_id, final_score, passed, student_id')
      .in('exam_id', []),  // placeholder — replaced below
  ])

  // Now fetch results properly scoped to lecturer's exams
  const myExamIds = (myExams ?? []).map(e => e.id)
  const { data: resultsData } = myExamIds.length
    ? await supabase
        .from('results')
        .select('exam_id, final_score, passed, student_id')
        .in('exam_id', myExamIds)
    : { data: [] }

  // ── Compute stats ────────────────────────────────────────────────────────────
  const liveExams      = (myExams ?? []).filter(e => e.status === 'live')
  const closedExams    = (myExams ?? []).filter(e => e.status === 'closed')
  const draftExams     = (myExams ?? []).filter(e => e.status === 'draft')
  const scheduledExams = (myExams ?? []).filter(e => e.status === 'scheduled')

  const totalStudentResults = (resultsData ?? []).length
  const passedResults       = (resultsData ?? []).filter(r => r.passed).length
  const overallPassRate     = totalStudentResults > 0
    ? Math.round((passedResults / totalStudentResults) * 100)
    : null

  // Per-exam stats
  const examStatsMap = {}
  for (const r of resultsData ?? []) {
    if (!examStatsMap[r.exam_id]) examStatsMap[r.exam_id] = { total: 0, passed: 0, sumScore: 0 }
    examStatsMap[r.exam_id].total++
    if (r.passed) examStatsMap[r.exam_id].passed++
    examStatsMap[r.exam_id].sumScore += r.final_score ?? 0
  }

  // Identify at-risk students: failed any of my exams
  const atRiskStudentIds = new Set(
    (resultsData ?? []).filter(r => !r.passed).map(r => r.student_id)
  )

  const enrichedExams = (myExams ?? []).map(e => {
    const totalMarks = (e.exam_questions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)
    const stats      = examStatsMap[e.id] ?? { total: 0, passed: 0, sumScore: 0 }
    const passRate   = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : null
    const avgScore   = stats.total > 0 ? Math.round(stats.sumScore / stats.total) : null
    return { ...e, totalMarks, stats, passRate, avgScore }
  })

  const recentExams = enrichedExams.slice(0, 6)

  const addQuestion = (
    <Link href="/lecturer/questions/new">
      <div className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors">
        <Plus size={14} />
        Add question
      </div>
    </Link>
  )

  return (
    <div className="h-full flex flex-col">
      <TopBar
        title="Dashboard"
        subtitle={`Welcome back, ${user.full_name}`}
        actions={addQuestion}
      />
      <main className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Top stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={FileQuestion} label="Questions"      value={questionCount ?? 0}   href="/lecturer/questions" />
          <StatCard icon={ScrollText}   label="Total Exams"    value={(myExams ?? []).length} href="/lecturer/exams" />
          <StatCard icon={Users}        label="Students Sat"   value={totalStudentResults} />
          <StatCard
            icon={BarChart2}
            label="Overall Pass Rate"
            value={overallPassRate !== null ? `${overallPassRate}%` : '—'}
            valueColor={overallPassRate !== null ? (overallPassRate >= 60 ? 'text-success' : 'text-danger') : undefined}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: exam pipeline + performance */}
          <div className="lg:col-span-2 space-y-5">
            {/* Exam status pipeline */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-text-primary mb-4">Exam Pipeline</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Draft',      count: draftExams.length,     color: 'bg-slate-100 text-text-muted',    dot: 'bg-slate-400' },
                  { label: 'Scheduled',  count: scheduledExams.length, color: 'bg-primary-light text-primary',   dot: 'bg-primary' },
                  { label: 'Live',       count: liveExams.length,      color: 'bg-success-light text-success',   dot: 'bg-success' },
                  { label: 'Closed',     count: closedExams.length,    color: 'bg-slate-100 text-text-secondary', dot: 'bg-slate-500' },
                ].map(s => (
                  <div key={s.label} className={`rounded-lg px-4 py-3 ${s.color}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`size-2 rounded-full ${s.dot}`} />
                      <span className="text-xs font-medium opacity-80">{s.label}</span>
                    </div>
                    <p className="text-2xl font-bold">{s.count}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent exams with performance */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-text-primary">Exam Performance</h2>
                <Link href="/lecturer/results" className="text-xs text-primary hover:underline flex items-center gap-1">
                  Full results <ArrowRight size={11} />
                </Link>
              </div>
              <div className="divide-y divide-border">
                {recentExams.length === 0 && (
                  <p className="text-sm text-text-muted py-4">No exams yet. <Link href="/lecturer/exams/new" className="text-primary underline">Create one</Link>.</p>
                )}
                {recentExams.map(exam => (
                  <div key={exam.id} className="py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-xs font-mono text-text-muted bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                          {exam.courses?.course_code}
                        </span>
                        <Badge variant={exam.status} />
                      </div>
                      <p className="text-sm font-medium text-text-primary truncate">{exam.title}</p>
                      {exam.stats.total > 0 && (
                        <div className="mt-1.5">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-text-muted">{exam.stats.total} submissions</span>
                            <span className={`font-semibold ${exam.passRate >= 60 ? 'text-success' : 'text-danger'}`}>
                              {exam.passRate}% pass rate
                            </span>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full bar-chart-bar ${exam.passRate >= 60 ? 'bg-success' : 'bg-danger'}`}
                              style={{ width: `${exam.passRate}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {exam.stats.total === 0 && exam.status !== 'draft' && (
                        <p className="text-xs text-text-muted mt-0.5">No submissions yet</p>
                      )}
                    </div>
                    <Link
                      href={`/lecturer/exams/${exam.id}/results`}
                      className="shrink-0 flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
                    >
                      <Eye size={13} />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: at-risk + quick stats */}
          <div className="space-y-5">
            {/* Class health */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-text-primary mb-4">Class Health</h2>
              <div className="space-y-3">
                <HealthRow label="Students sat exams"   value={totalStudentResults} max={null} />
                <HealthRow label="Passed"               value={passedResults}       max={totalStudentResults} color="success" />
                <HealthRow label="Failed"               value={totalStudentResults - passedResults} max={totalStudentResults} color="danger" />
                <HealthRow label="At-risk students"     value={atRiskStudentIds.size} max={null} alert={atRiskStudentIds.size > 0} />
              </div>
            </div>

            {/* Question bank health */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-text-primary">Question Bank</h2>
                <Link href="/lecturer/questions" className="text-xs text-primary hover:underline">View all</Link>
              </div>
              <p className="text-3xl font-bold text-text-primary tabular-nums">{questionCount ?? 0}</p>
              <p className="text-xs text-text-muted mt-0.5">active questions</p>
              <Link
                href="/lecturer/questions/new"
                className="mt-3 flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <Plus size={12} />
                Add a question
              </Link>
            </div>

            {/* Quick actions */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-text-primary mb-3">Quick Actions</h2>
              <div className="space-y-2">
                {[
                  { href: '/lecturer/exams/new',    label: 'Create new exam',     icon: ScrollText },
                  { href: '/lecturer/questions/new', label: 'Add a question',      icon: FileQuestion },
                  { href: '/lecturer/results',       label: 'View all results',    icon: BarChart2 },
                ].map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-text-secondary hover:bg-page hover:text-primary transition-colors"
                  >
                    <Icon size={14} />
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, href, valueColor }) {
  const content = (
    <div className="bg-surface border border-border rounded-xl p-5 flex items-center gap-4 hover:border-primary/30 transition-colors">
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary-light shrink-0">
        <Icon className="size-5 text-primary" />
      </span>
      <div>
        <p className={`text-2xl font-bold tabular-nums ${valueColor ?? 'text-text-primary'}`}>{value}</p>
        <p className="text-sm text-text-secondary">{label}</p>
      </div>
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : content
}

function HealthRow({ label, value, max, color, alert }) {
  const pct = max ? Math.round((value / max) * 100) : null
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className={`text-text-secondary ${alert && value > 0 ? 'text-warning font-medium' : ''}`}>{label}</span>
        <span className={`font-semibold tabular-nums ${
          alert && value > 0 ? 'text-warning' :
          color === 'success' ? 'text-success' :
          color === 'danger'  ? 'text-danger'  :
          'text-text-primary'
        }`}>{value}</span>
      </div>
      {pct !== null && (
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full bar-chart-bar ${color === 'success' ? 'bg-success' : color === 'danger' ? 'bg-danger' : 'bg-primary'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}
