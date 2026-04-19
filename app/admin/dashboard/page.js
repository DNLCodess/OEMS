import Link from 'next/link'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { Badge } from '@/components/ui/Badge'
import {
  Users, ClipboardList, BookOpen, GraduationCap, ArrowRight,
  TrendingUp, AlertTriangle, CheckCircle2, Clock, Building2,
} from 'lucide-react'

export const metadata = { title: 'Dashboard' }

export default async function AdminDashboardPage() {
  const user     = await requireRole('school_admin')
  const supabase = await createClient()

  const [
    { count: lecturerCount },
    { count: studentCount },
    { count: activeExamCount },
    { count: courseCount },
    { count: deptCount },
    { data: recentExams },
    { data: departments },
    { data: allResults },
    { data: closedExams },
  ] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true })
      .eq('university_id', user.university_id).eq('role', 'lecturer').eq('is_active', true),
    supabase.from('users').select('id', { count: 'exact', head: true })
      .eq('university_id', user.university_id).eq('role', 'student').eq('is_active', true),
    supabase.from('exams').select('id', { count: 'exact', head: true })
      .eq('university_id', user.university_id).in('status', ['scheduled', 'live']),
    supabase.from('courses').select('id', { count: 'exact', head: true })
      .eq('university_id', user.university_id),
    supabase.from('departments').select('id', { count: 'exact', head: true })
      .eq('university_id', user.university_id),

    // Recent exams with lecturer + status
    supabase.from('exams')
      .select('id, title, status, created_at, courses!course_id ( course_code ), users:created_by ( full_name )')
      .eq('university_id', user.university_id)
      .order('created_at', { ascending: false })
      .limit(8),

    // Departments with student/lecturer count
    supabase.from('departments')
      .select('id, name, faculties ( name )')
      .eq('university_id', user.university_id)
      .order('name'),

    // Released results for pass rate computation
    supabase.from('results')
      .select('passed, exam_id')
      .not('released_at', 'is', null)
      .in('exam_id',
        // subquery workaround — fetch exam ids first below
        ['00000000-0000-0000-0000-000000000000']
      ),

    // Closed exams for result health
    supabase.from('exams')
      .select('id')
      .eq('university_id', user.university_id)
      .eq('status', 'closed'),
  ])

  // Re-fetch results properly scoped to this university's exams
  const uniExamIds = (closedExams ?? []).map(e => e.id)
  const { data: uniResults } = uniExamIds.length
    ? await supabase
        .from('results')
        .select('passed, released_at')
        .in('exam_id', uniExamIds)
    : { data: [] }

  // Dept user counts
  const { data: deptUsers } = await supabase
    .from('users')
    .select('department_id, role')
    .eq('university_id', user.university_id)
    .eq('is_active', true)
    .in('role', ['student', 'lecturer'])

  const deptMap = {}
  for (const u of deptUsers ?? []) {
    if (!u.department_id) continue
    if (!deptMap[u.department_id]) deptMap[u.department_id] = { students: 0, lecturers: 0 }
    if (u.role === 'student')  deptMap[u.department_id].students++
    if (u.role === 'lecturer') deptMap[u.department_id].lecturers++
  }

  const enrichedDepts = (departments ?? [])
    .map(d => ({ ...d, ...( deptMap[d.id] ?? { students: 0, lecturers: 0 }) }))
    .sort((a, b) => b.students - a.students)
    .slice(0, 6)

  // Result health
  const totalResults    = (uniResults ?? []).length
  const passedResults   = (uniResults ?? []).filter(r => r.passed).length
  const releasedResults = (uniResults ?? []).filter(r => r.released_at).length
  const overallPassRate = totalResults > 0 ? Math.round((passedResults / totalResults) * 100) : null

  const examStatusBreakdown = {
    draft:      (recentExams ?? []).filter(e => e.status === 'draft').length,
    scheduled:  (recentExams ?? []).filter(e => e.status === 'scheduled').length,
    live:       (recentExams ?? []).filter(e => e.status === 'live').length,
    closed:     (recentExams ?? []).filter(e => e.status === 'closed').length,
  }

  return (
    <div className="h-full flex flex-col">
      <TopBar
        title="Exam Officer Dashboard"
        subtitle={`Welcome back, ${user.full_name}`}
      />
      <main className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Top stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Users}         label="Lecturers"    value={lecturerCount ?? 0}   href="/admin/users" />
          <StatCard icon={GraduationCap} label="Students"     value={studentCount ?? 0}    href="/admin/users" />
          <StatCard icon={ClipboardList} label="Active Exams" value={activeExamCount ?? 0} href="/admin/exams" />
          <StatCard icon={BookOpen}      label="Courses"      value={courseCount ?? 0}     href="/admin/courses" />
        </div>

        {/* Platform health alerts */}
        {overallPassRate !== null && overallPassRate < 50 && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <AlertTriangle size={15} className="text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800">
              Overall pass rate is <span className="font-semibold">{overallPassRate}%</span> — below 50%. Consider reviewing exam difficulty or student support.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left col */}
          <div className="lg:col-span-2 space-y-5">
            {/* Exam pipeline */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-text-primary">Exam Pipeline</h2>
                <Link href="/admin/exams" className="text-xs text-primary hover:underline flex items-center gap-1">
                  View all <ArrowRight size={11} />
                </Link>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                {[
                  { label: 'Draft',     count: examStatusBreakdown.draft,     color: 'bg-slate-100 text-text-muted',     dot: 'bg-slate-400' },
                  { label: 'Scheduled', count: examStatusBreakdown.scheduled, color: 'bg-primary-light text-primary',    dot: 'bg-primary' },
                  { label: 'Live',      count: examStatusBreakdown.live,      color: 'bg-success-light text-success',    dot: 'bg-success' },
                  { label: 'Closed',    count: examStatusBreakdown.closed,    color: 'bg-slate-100 text-text-secondary', dot: 'bg-slate-500' },
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

              {/* Recent exams list */}
              <div className="divide-y divide-border">
                {(recentExams ?? []).slice(0, 6).map(exam => (
                  <div key={exam.id} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-mono text-text-muted bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                        {exam.courses?.course_code}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm text-text-primary truncate">{exam.title}</p>
                        <p className="text-xs text-text-muted">{exam.users?.full_name}</p>
                      </div>
                    </div>
                    <Badge variant={exam.status} />
                  </div>
                ))}
              </div>
            </div>

            {/* Department breakdown */}
            {enrichedDepts.length > 0 && (
              <div className="bg-surface border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-text-primary">Departments</h2>
                  <Link href="/admin/structure" className="text-xs text-primary hover:underline flex items-center gap-1">
                    Manage <ArrowRight size={11} />
                  </Link>
                </div>
                <div className="divide-y divide-border">
                  {enrichedDepts.map(dept => (
                    <div key={dept.id} className="py-3 flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{dept.name}</p>
                        {dept.faculties?.name && (
                          <p className="text-xs text-text-muted">{dept.faculties.name}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-4 shrink-0 ml-3">
                        <div className="text-center">
                          <p className="text-sm font-bold text-text-primary tabular-nums">{dept.students}</p>
                          <p className="text-xs text-text-muted">Students</p>
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-bold text-text-primary tabular-nums">{dept.lecturers}</p>
                          <p className="text-xs text-text-muted">Lecturers</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right col */}
          <div className="space-y-5">
            {/* Result health */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-text-primary mb-4">Results Health</h2>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-text-secondary">Overall Pass Rate</span>
                    <span className={`font-semibold ${
                      overallPassRate === null ? 'text-text-muted' :
                      overallPassRate >= 60 ? 'text-success' : 'text-danger'
                    }`}>
                      {overallPassRate !== null ? `${overallPassRate}%` : 'N/A'}
                    </span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full bar-chart-bar ${overallPassRate >= 60 ? 'bg-success' : 'bg-danger'}`}
                      style={{ width: `${overallPassRate ?? 0}%` }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-success-light border border-success/20 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-success tabular-nums">{passedResults}</p>
                    <p className="text-xs text-success/70">Passed</p>
                  </div>
                  <div className="bg-danger-light border border-danger/20 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-danger tabular-nums">{totalResults - passedResults}</p>
                    <p className="text-xs text-danger/70">Failed</p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs py-2 border-t border-border">
                  <span className="text-text-muted">Results released</span>
                  <span className="font-medium text-text-primary">{releasedResults}/{totalResults}</span>
                </div>
              </div>
            </div>

            {/* Quick links */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-text-primary mb-3">Management</h2>
              <div className="space-y-2">
                {[
                  { href: '/admin/users',     label: 'Manage Users',       icon: Users },
                  { href: '/admin/courses',   label: 'Manage Courses',     icon: BookOpen },
                  { href: '/admin/structure', label: 'Faculty & Depts',    icon: Building2 },
                  { href: '/admin/exams',     label: 'All Exams',          icon: ClipboardList },
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

function StatCard({ icon: Icon, label, value, href }) {
  const content = (
    <div className="bg-surface border border-border rounded-xl p-5 flex items-center gap-4 hover:border-primary/30 transition-colors">
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary-light shrink-0">
        <Icon className="size-5 text-primary" />
      </span>
      <div>
        <p className="text-2xl font-bold text-text-primary tabular-nums">{value}</p>
        <p className="text-sm text-text-secondary">{label}</p>
      </div>
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : content
}
