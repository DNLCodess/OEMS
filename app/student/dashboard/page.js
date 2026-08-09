import Link from 'next/link'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import {
  ClipboardList, CheckCircle2, XCircle, Clock, ArrowRight,
  TrendingUp, TrendingDown, Minus, BookOpen, Target, AlertCircle,
} from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'

export const metadata = { title: 'Dashboard' }

export default async function StudentDashboardPage() {
  const user     = await requireRole('student')
  const supabase = await createClient()
  const now      = new Date()

  const [
    { data: allResults },
    { data: liveExams },
    { data: scheduledExams },
    { data: attempts },
  ] = await Promise.all([
    // All results with course and marks data
    supabase
      .from('results')
      .select(`
        final_score, passed,
        exams:exam_id (
          id, title, pass_mark,
          courses!course_id ( course_code, course_title ),
          exam_questions ( marks )
        )
      `)
      .eq('student_id', user.id)
      .order('created_at', { ascending: false }),

    // Available live exams right now
    supabase
      .from('exams')
      .select('id, title, end_at, courses!course_id ( course_code )')
      .eq('university_id', user.university_id)
      .eq('status', 'live')
      .lte('start_at', now.toISOString())
      .gte('end_at', now.toISOString())
      .order('end_at', { ascending: true })
      .limit(5),

    // Scheduled upcoming exams
    supabase
      .from('exams')
      .select('id, title, start_at, courses!course_id ( course_code )')
      .eq('university_id', user.university_id)
      .eq('status', 'scheduled')
      .gte('start_at', now.toISOString())
      .order('start_at', { ascending: true })
      .limit(5),

    // Student's own in-progress or submitted attempts (for "started but not graded" count)
    supabase
      .from('attempts')
      .select('exam_id, status')
      .eq('student_id', user.id),
  ])

  // ── Compute stats ────────────────────────────────────────────────────────────
  const enriched = (allResults ?? []).map(r => {
    const totalMarks = (r.exams?.exam_questions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)
    const pct = totalMarks > 0 ? Math.round((r.final_score / totalMarks) * 100) : 0
    return { ...r, totalMarks, pct, exam: r.exams }
  })

  const totalReleased  = enriched.length
  const passedCount    = enriched.filter(r => r.passed).length
  const failedCount    = totalReleased - passedCount
  const passRate       = totalReleased > 0 ? Math.round((passedCount / totalReleased) * 100) : null
  const avgPct         = totalReleased > 0
    ? Math.round(enriched.reduce((s, r) => s + r.pct, 0) / totalReleased)
    : null

  // Trend: compare last 3 avg vs previous 3 avg
  const last3    = enriched.slice(0, 3)
  const prev3    = enriched.slice(3, 6)
  const avg3     = arr => arr.length ? Math.round(arr.reduce((s, r) => s + r.pct, 0) / arr.length) : null
  const trendNow = avg3(last3)
  const trendPrev= avg3(prev3)
  const trend    = trendNow !== null && trendPrev !== null
    ? trendNow > trendPrev + 3 ? 'up' : trendNow < trendPrev - 3 ? 'down' : 'steady'
    : null

  // Per-course performance
  const courseMap = {}
  for (const r of enriched) {
    const code = r.exam?.courses?.course_code ?? 'Other'
    const title = r.exam?.courses?.course_title ?? ''
    if (!courseMap[code]) courseMap[code] = { code, title, total: 0, sumPct: 0, passed: 0 }
    courseMap[code].total++
    courseMap[code].sumPct += r.pct
    if (r.passed) courseMap[code].passed++
  }
  const courseStats = Object.values(courseMap)
    .map(c => ({ ...c, avgPct: Math.round(c.sumPct / c.total) }))
    .sort((a, b) => a.avgPct - b.avgPct) // weakest first

  const weakCourses   = courseStats.filter(c => c.avgPct < 60)
  const strongCourses = courseStats.filter(c => c.avgPct >= 70)

  const submittedExamIds = new Set((attempts ?? []).map(a => a.exam_id))
  const availableLive    = (liveExams ?? []).filter(e => !submittedExamIds.has(e.id))

  return (
    <div className="h-full flex flex-col">
      <TopBar
        title="Dashboard"
        subtitle={`Welcome back, ${user.full_name}`}
      />
      <main className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Identity strip */}
        {user.matric_number && (
          <div className="bg-primary-light border border-primary/15 rounded-xl px-5 py-3 flex items-center gap-4 flex-wrap">
            <div>
              <p className="text-xs text-text-muted">Matric Number</p>
              <p className="font-mono text-sm font-semibold text-primary">{user.matric_number}</p>
            </div>
            {user.level && (
              <div className="border-l border-primary/20 pl-4">
                <p className="text-xs text-text-muted">Level</p>
                <p className="text-sm font-semibold text-primary">{user.level}L</p>
              </div>
            )}
          </div>
        )}

        {/* Action alerts — live exams available */}
        {availableLive.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle size={16} className="text-amber-600 shrink-0" />
              <p className="text-sm font-semibold text-amber-800">
                {availableLive.length} exam{availableLive.length > 1 ? 's' : ''} available now
              </p>
            </div>
            <div className="space-y-2">
              {availableLive.map(e => (
                <Link
                  key={e.id}
                  href={`/student/exams/${e.id}`}
                  className="flex items-center justify-between bg-white rounded-lg px-3 py-2.5 border border-amber-200 hover:border-amber-400 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                      {e.courses?.course_code}
                    </span>
                    <span className="text-sm font-medium text-text-primary">{e.title}</span>
                  </div>
                  <div className="text-xs text-amber-600 shrink-0 ml-2">
                    Ends {formatDistanceToNow(new Date(e.end_at), { addSuffix: true })}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Performance overview */}
        {totalReleased > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Pass Rate"
              value={`${passRate}%`}
              sub={`${passedCount} of ${totalReleased} passed`}
              color={passRate >= 70 ? 'success' : passRate >= 50 ? 'warning' : 'danger'}
            />
            <StatCard
              label="Average Score"
              value={`${avgPct}%`}
              sub="across all completed exams"
              color={avgPct >= 70 ? 'success' : avgPct >= 50 ? 'warning' : 'danger'}
            />
            <StatCard
              label="Exams Passed"
              value={passedCount}
              sub={`${failedCount} failed`}
              color="neutral"
            />
            <TrendCard trend={trend} trendNow={trendNow} trendPrev={trendPrev} />
          </div>
        )}

        {totalReleased === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Available Exams"  value={availableLive.length}  sub="live right now"  color="neutral" />
            <StatCard label="Scheduled"        value={(scheduledExams ?? []).length} sub="coming up" color="neutral" />
            <StatCard label="Exams Completed"  value={(attempts ?? []).filter(a => a.status !== 'in_progress').length} sub="submitted" color="neutral" />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column — score bar chart + recent results */}
          <div className="lg:col-span-2 space-y-6">
            {/* Score history chart */}
            {enriched.length > 0 && (
              <div className="bg-surface border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-text-primary">Score History</h2>
                  <Link href="/student/results" className="text-xs text-primary hover:underline flex items-center gap-1">
                    All results <ArrowRight size={11} />
                  </Link>
                </div>
                <div className="space-y-2.5">
                  {enriched.slice(0, 6).map((r, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="font-mono text-xs text-text-muted w-16 shrink-0 truncate">
                        {r.exam?.courses?.course_code ?? '—'}
                      </span>
                      <div className="flex-1 bg-slate-100 rounded-full h-5 relative overflow-hidden">
                        <div
                          className={`h-full rounded-full bar-chart-bar ${
                            r.passed ? 'bg-success/80' : 'bg-danger/70'
                          }`}
                          style={{ width: `${r.pct}%` }}
                        />
                        <span className="absolute inset-0 flex items-center px-2.5 text-xs font-medium text-text-primary">
                          {r.pct}%
                        </span>
                      </div>
                      <span className={`shrink-0 text-xs font-semibold w-8 text-right ${r.passed ? 'text-success' : 'text-danger'}`}>
                        {r.passed ? 'P' : 'F'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upcoming exams */}
            {(scheduledExams ?? []).length > 0 && (
              <div className="bg-surface border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-text-primary">Upcoming Exams</h2>
                  <Link href="/student/exams" className="text-xs text-primary hover:underline flex items-center gap-1">
                    View all <ArrowRight size={11} />
                  </Link>
                </div>
                <div className="divide-y divide-border">
                  {(scheduledExams ?? []).map(e => (
                    <div key={e.id} className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs text-text-muted bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                          {e.courses?.course_code}
                        </span>
                        <span className="text-sm text-text-primary truncate">{e.title}</span>
                      </div>
                      <div className="shrink-0 ml-2 text-right">
                        <p className="text-xs font-medium text-text-secondary">
                          {format(new Date(e.start_at), 'MMM d')}
                        </p>
                        <p className="text-xs text-text-muted">
                          {format(new Date(e.start_at), 'HH:mm')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right column — course breakdown + focus areas */}
          <div className="space-y-6">
            {/* Focus areas */}
            {weakCourses.length > 0 && (
              <div className="bg-danger-light border border-danger/20 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Target size={15} className="text-danger" />
                  <h2 className="text-sm font-semibold text-danger">Needs Attention</h2>
                </div>
                <div className="space-y-3">
                  {weakCourses.map(c => (
                    <div key={c.code}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-mono font-medium text-text-primary">{c.code}</span>
                        <span className="text-danger font-semibold">{c.avgPct}% avg</span>
                      </div>
                      <div className="h-2 bg-danger/15 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-danger/60 rounded-full bar-chart-bar"
                          style={{ width: `${c.avgPct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-danger/70 mt-3">
                  Focus your revision on these courses before your next exam.
                </p>
              </div>
            )}

            {/* Strong courses */}
            {strongCourses.length > 0 && (
              <div className="bg-success-light border border-success/20 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 size={15} className="text-success" />
                  <h2 className="text-sm font-semibold text-success">Performing Well</h2>
                </div>
                <div className="space-y-3">
                  {strongCourses.map(c => (
                    <div key={c.code}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-mono font-medium text-text-primary">{c.code}</span>
                        <span className="text-success font-semibold">{c.avgPct}% avg</span>
                      </div>
                      <div className="h-2 bg-success/15 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-success/60 rounded-full bar-chart-bar"
                          style={{ width: `${c.avgPct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick links */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-text-primary mb-3">Quick Links</h2>
              <div className="space-y-2">
                {[
                  { href: '/student/exams',   label: 'Available Exams', icon: ClipboardList },
                  { href: '/student/results',  label: 'My Results',      icon: BarChart2Icon },
                ].map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-text-secondary hover:bg-page hover:text-primary transition-colors"
                  >
                    <Icon size={15} />
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

function BarChart2Icon(props) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6"  y1="20" x2="6"  y2="14" />
      <line x1="2"  y1="20" x2="22" y2="20" />
    </svg>
  )
}

function StatCard({ label, value, sub, color }) {
  const colors = {
    success: 'border-success/20 bg-success-light',
    warning: 'border-amber-200 bg-amber-50',
    danger:  'border-danger/20 bg-danger-light',
    neutral: 'border-border bg-surface',
  }
  const textColors = {
    success: 'text-success',
    warning: 'text-amber-700',
    danger:  'text-danger',
    neutral: 'text-text-primary',
  }
  return (
    <div className={`border rounded-xl p-5 ${colors[color]}`}>
      <p className={`text-2xl font-bold tabular-nums ${textColors[color]}`}>{value}</p>
      <p className="text-sm font-medium text-text-secondary mt-0.5">{label}</p>
      {sub && <p className="text-xs text-text-muted mt-1">{sub}</p>}
    </div>
  )
}

function TrendCard({ trend, trendNow, trendPrev }) {
  if (!trend) {
    return (
      <div className="border border-border bg-surface rounded-xl p-5">
        <p className="text-2xl font-bold text-text-muted">—</p>
        <p className="text-sm font-medium text-text-secondary mt-0.5">Trend</p>
        <p className="text-xs text-text-muted mt-1">Complete more exams to see your trend</p>
      </div>
    )
  }
  const cfg = {
    up:     { Icon: TrendingUp,   color: 'text-success', bg: 'border-success/20 bg-success-light', label: 'Improving', sub: `Up from ${trendPrev}% → ${trendNow}%` },
    down:   { Icon: TrendingDown, color: 'text-danger',  bg: 'border-danger/20 bg-danger-light',   label: 'Declining', sub: `Down from ${trendPrev}% → ${trendNow}%` },
    steady: { Icon: Minus,        color: 'text-primary', bg: 'border-border bg-surface',            label: 'Steady',   sub: `Consistent around ${trendNow}%` },
  }[trend]
  return (
    <div className={`border rounded-xl p-5 ${cfg.bg}`}>
      <cfg.Icon size={24} className={cfg.color} />
      <p className={`text-sm font-semibold mt-1 ${cfg.color}`}>{cfg.label}</p>
      <p className="text-sm font-medium text-text-secondary mt-0.5">Trend</p>
      <p className="text-xs text-text-muted mt-1">{cfg.sub}</p>
    </div>
  )
}
