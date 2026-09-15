import Link from 'next/link'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { listCourses, listDepartments } from '@/lib/db/repositories/structure'
import { listStaffAndStudents } from '@/lib/db/repositories/users'
import { TopBar } from '@/components/shared/TopBar'
import { Badge } from '@/components/ui/Badge'
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
import {
  Users, ClipboardList, BookOpen, GraduationCap, ArrowRight,
} from 'lucide-react'

export const metadata = { title: 'Dashboard' }

export default async function AdminDashboardPage() {
  const user     = await requireRole('school_admin', 'super_admin')
  const supabase = await createClient()

  // Prisma-backed: users and structure are ported this slice.
  const [allUsers, departments, courses] = await Promise.all([
    listStaffAndStudents({ excludeUserId: user.id }),
    listDepartments(),
    listCourses(),
  ])
  const lecturerCount = allUsers.filter(u => u.role === 'lecturer' && u.is_active).length
  const studentCount  = allUsers.filter(u => u.role === 'student' && u.is_active).length

  // Supabase-backed: exams/attempts/results aren't ported until Slices 5–6 —
  // their SQL Server tables exist but are empty, so these counts must keep
  // reading the pre-migration data source for now.
  const [
    { count: activeExamCount, error: activeExamCountError },
    { data: recentExams, error: recentExamsError },
    { data: closedExams, error: closedExamsError },
  ] = await Promise.all([
    supabase.from('exams').select('id', { count: 'exact', head: true })
      .eq('university_id', user.university_id).in('status', ['scheduled', 'live']),
    supabase.from('exams')
      .select('id, title, status, created_at, courses!course_id ( course_code ), users:created_by ( full_name )')
      .eq('university_id', user.university_id)
      .order('created_at', { ascending: false })
      .limit(8),
    supabase.from('exams').select('id').eq('university_id', user.university_id).eq('status', 'closed'),
  ])

  const uniExamIds = (closedExams ?? []).map(e => e.id)
  const { data: uniResults, error: uniResultsError } = uniExamIds.length
    ? await supabase.from('results').select('passed').in('exam_id', uniExamIds)
    : { data: [] }

  const dashboardError = activeExamCountError || recentExamsError || closedExamsError || uniResultsError
  if (dashboardError) console.error('[AdminDashboardPage]', dashboardError)

  const deptMap = {}
  for (const u of allUsers) {
    if (!u.department?.name) continue
    // department relation only gives us the name here, not the id — group
    // by name (department names are unique within their own faculty, and
    // this dashboard doesn't need cross-faculty disambiguation).
    const key = u.department.name
    if (!deptMap[key]) deptMap[key] = { students: 0, lecturers: 0 }
    if (u.role === 'student')  deptMap[key].students++
    if (u.role === 'lecturer') deptMap[key].lecturers++
  }
  const enrichedDepts = departments
    .map(d => ({ ...d, ...(deptMap[d.name] ?? { students: 0, lecturers: 0 }) }))
    .sort((a, b) => b.students - a.students)
    .slice(0, 6)

  const passRate = (uniResults ?? []).length > 0
    ? Math.round(((uniResults ?? []).filter(r => r.passed).length / uniResults.length) * 100)
    : null

  return (
    <>
      <TopBar title="Dashboard" subtitle={`Welcome back, ${user.full_name}`} />
      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={GraduationCap}  label="Lecturers"     value={lecturerCount} href="/admin/users" />
          <StatCard icon={Users}          label="Students"      value={studentCount}  href="/admin/users" />
          <StatCard icon={BookOpen}       label="Courses"       value={courses.length} href="/admin/courses" />
          <StatCard icon={ClipboardList}  label="Active Exams"  value={activeExamCount ?? 0} href="/admin/exams" />
        </div>

        {dashboardError ? (
          <QueryErrorBanner message="Failed to load some dashboard data. Please refresh." />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">Recent Exams</h2>
                <Link href="/admin/exams" className="text-xs text-primary hover:underline flex items-center gap-1">
                  View all <ArrowRight size={11} />
                </Link>
              </div>
              {(recentExams ?? []).length === 0 ? (
                <div className="bg-surface border border-border rounded-xl p-8 text-center">
                  <ClipboardList size={32} className="text-text-muted mx-auto mb-3" />
                  <p className="text-sm text-text-muted">No exams yet.</p>
                </div>
              ) : (
                <div className="bg-surface border border-border rounded-xl divide-y divide-border">
                  {recentExams.map(exam => (
                    <div key={exam.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="font-mono text-xs text-text-muted">{exam.courses?.course_code}</span>
                          <Badge variant={exam.status} />
                        </div>
                        <p className="text-sm font-medium text-text-primary">{exam.title}</p>
                        <p className="text-xs text-text-muted">by {exam.users?.full_name ?? '—'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-5">
              <div className="bg-surface border border-border rounded-xl p-5">
                <h2 className="text-sm font-semibold text-text-primary mb-4">Institution Health</h2>
                <div className="space-y-3">
                  {[
                    { label: 'Departments', value: departments.length },
                    { label: 'Courses',     value: courses.length },
                    { label: 'Pass rate',   value: passRate !== null ? `${passRate}%` : '—' },
                  ].map(s => (
                    <div key={s.label} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                      <span className="text-xs text-text-muted">{s.label}</span>
                      <span className="text-sm font-semibold text-text-primary tabular-nums">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {enrichedDepts.length > 0 && (
                <div className="bg-surface border border-border rounded-xl p-5">
                  <h2 className="text-sm font-semibold text-text-primary mb-4">Top Departments</h2>
                  <div className="space-y-2">
                    {enrichedDepts.map(d => (
                      <div key={d.id} className="flex items-center justify-between text-xs">
                        <span className="text-text-secondary">{d.name}</span>
                        <span className="text-text-muted">{d.students} students · {d.lecturers} lecturers</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </>
  )
}

function StatCard({ icon: Icon, label, value, href }) {
  const content = (
    <div className="bg-surface border border-border rounded-xl p-5 flex items-center gap-4 hover:border-primary/30 transition-colors">
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary-light shrink-0">
        <Icon className="size-5 text-primary" />
      </span>
      <div>
        <p className="text-2xl font-bold tabular-nums text-text-primary">{value}</p>
        <p className="text-sm text-text-secondary">{label}</p>
      </div>
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : content
}
