import Link from 'next/link'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { Building2, Users, ShieldCheck, ArrowRight, BookOpen, ClipboardList, TrendingUp, GraduationCap } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { format } from 'date-fns'

export const metadata = { title: 'Platform Dashboard' }

export default async function SuperAdminDashboardPage() {
  const user     = await requireRole('super_admin')
  const supabase = await createClient()

  const [
    { data: universities },
    { count: totalUsers },
    { count: totalExams },
    { count: liveExams },
    { data: allUsers },
    { data: allResults },
    { data: recentExams },
  ] = await Promise.all([
    supabase.from('universities')
      .select('id, name, subdomain, created_at')
      .order('created_at', { ascending: false }),

    supabase.from('users').select('id', { count: 'exact', head: true }),
    supabase.from('exams').select('id', { count: 'exact', head: true }),
    supabase.from('exams').select('id', { count: 'exact', head: true }).in('status', ['live', 'scheduled']),

    // Users per university, with role
    supabase.from('users')
      .select('university_id, role, is_active'),

    // Results for pass rate
    supabase.from('results')
      .select('passed, exam_id')
      .not('released_at', 'is', null)
      .limit(5000),

    // Latest exams platform-wide
    supabase.from('exams')
      .select('id, title, status, created_at, universities ( name ), courses!course_id ( course_code )')
      .order('created_at', { ascending: false })
      .limit(6),
  ])

  // Per-university aggregates
  const uniUserMap = {}
  for (const u of allUsers ?? []) {
    if (!u.university_id) continue
    if (!uniUserMap[u.university_id]) uniUserMap[u.university_id] = { students: 0, lecturers: 0, admins: 0 }
    if (u.role === 'student')      uniUserMap[u.university_id].students++
    else if (u.role === 'lecturer') uniUserMap[u.university_id].lecturers++
    else if (u.role === 'school_admin') uniUserMap[u.university_id].admins++
  }

  // Exams per university
  const { data: allExams } = await supabase
    .from('exams')
    .select('university_id, status')

  const uniExamMap = {}
  for (const e of allExams ?? []) {
    if (!uniExamMap[e.university_id]) uniExamMap[e.university_id] = { total: 0, live: 0, closed: 0 }
    uniExamMap[e.university_id].total++
    if (e.status === 'live')   uniExamMap[e.university_id].live++
    if (e.status === 'closed') uniExamMap[e.university_id].closed++
  }

  // Results per university (via exam join — but we have limited data, use passed counts)
  const platformPassed = (allResults ?? []).filter(r => r.passed).length
  const platformPassRate = (allResults ?? []).length > 0
    ? Math.round((platformPassed / allResults.length) * 100)
    : null

  const enrichedUnis = (universities ?? []).map(u => ({
    ...u,
    students:  uniUserMap[u.id]?.students  ?? 0,
    lecturers: uniUserMap[u.id]?.lecturers ?? 0,
    totalExams: uniExamMap[u.id]?.total   ?? 0,
    liveExams:  uniExamMap[u.id]?.live    ?? 0,
  }))

  return (
    <div className="h-full flex flex-col">
      <TopBar
        title="Platform Dashboard"
        subtitle={`Welcome back, ${user.full_name}`}
      />
      <main className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Platform-wide stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Building2}     label="Universities"     value={universities?.length ?? 0}  href="/super-admin/universities" />
          <StatCard icon={Users}         label="Total Users"      value={totalUsers ?? 0}             href="/super-admin/users" />
          <StatCard icon={ClipboardList} label="Total Exams"      value={totalExams ?? 0} />
          <StatCard
            icon={TrendingUp}
            label="Platform Pass Rate"
            value={platformPassRate !== null ? `${platformPassRate}%` : '—'}
            valueColor={platformPassRate !== null ? (platformPassRate >= 60 ? 'text-success' : 'text-danger') : undefined}
          />
        </div>

        {/* Active now */}
        {liveExams > 0 && (
          <div className="flex items-center gap-3 bg-success-light border border-success/20 rounded-xl px-4 py-3">
            <span className="size-2.5 rounded-full bg-success animate-pulse shrink-0" />
            <p className="text-sm text-success font-medium">
              {liveExams} exam{liveExams > 1 ? 's' : ''} live across the platform right now
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* University cards */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">Universities</h2>
              <Link href="/super-admin/universities" className="text-xs text-primary hover:underline flex items-center gap-1">
                Manage all <ArrowRight size={11} />
              </Link>
            </div>

            {enrichedUnis.length === 0 && (
              <div className="bg-surface border border-border rounded-xl p-8 text-center">
                <Building2 size={32} className="text-text-muted mx-auto mb-3" />
                <p className="text-sm text-text-muted">No universities onboarded yet.</p>
                <Link href="/super-admin/universities" className="mt-3 inline-block text-sm text-primary underline">
                  Add the first one
                </Link>
              </div>
            )}

            {enrichedUnis.map(uni => (
              <div key={uni.id} className="bg-surface border border-border rounded-xl p-5">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-text-primary">{uni.name}</p>
                    <p className="font-mono text-xs text-text-muted mt-0.5">{uni.subdomain}.oems.edu.ng</p>
                  </div>
                  <div className="shrink-0 text-xs text-text-muted">
                    Since {format(new Date(uni.created_at), 'MMM yyyy')}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Students',  value: uni.students,   color: 'text-text-primary' },
                    { label: 'Lecturers', value: uni.lecturers,  color: 'text-text-primary' },
                    { label: 'Exams',     value: uni.totalExams, color: 'text-text-primary' },
                    { label: 'Live now',  value: uni.liveExams,  color: uni.liveExams > 0 ? 'text-success' : 'text-text-muted' },
                  ].map(s => (
                    <div key={s.label} className="text-center bg-slate-50 rounded-lg py-2.5 px-1">
                      <p className={`text-lg font-bold tabular-nums ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-text-muted">{s.label}</p>
                    </div>
                  ))}
                </div>

                {/* Activity bar */}
                {uni.students > 0 && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs mb-1 text-text-muted">
                      <span>Student/lecturer ratio</span>
                      <span>{uni.lecturers > 0 ? Math.round(uni.students / uni.lecturers) : '—'}:1</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Right col */}
          <div className="space-y-5">
            {/* Platform health */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-text-primary mb-4">Platform Health</h2>
              <div className="space-y-3">
                {[
                  { label: 'Universities',    value: universities?.length ?? 0 },
                  { label: 'Total users',     value: totalUsers ?? 0 },
                  { label: 'Total exams',     value: totalExams ?? 0 },
                  { label: 'Results issued',  value: (allResults ?? []).length },
                  { label: 'Pass rate',       value: platformPassRate !== null ? `${platformPassRate}%` : '—' },
                ].map(s => (
                  <div key={s.label} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                    <span className="text-xs text-text-muted">{s.label}</span>
                    <span className="text-sm font-semibold text-text-primary tabular-nums">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent exams platform-wide */}
            {(recentExams ?? []).length > 0 && (
              <div className="bg-surface border border-border rounded-xl p-5">
                <h2 className="text-sm font-semibold text-text-primary mb-4">Latest Exams</h2>
                <div className="divide-y divide-border">
                  {(recentExams ?? []).map(exam => (
                    <div key={exam.id} className="py-2.5">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-mono text-xs text-text-muted">{exam.courses?.course_code}</span>
                        <Badge variant={exam.status} />
                      </div>
                      <p className="text-xs font-medium text-text-primary truncate">{exam.title}</p>
                      <p className="text-xs text-text-muted">{exam.universities?.name}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Admin links */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-text-primary mb-3">Administration</h2>
              <div className="space-y-2">
                {[
                  { href: '/super-admin/universities', label: 'Manage Universities', icon: Building2 },
                  { href: '/super-admin/users',        label: 'All Users',           icon: Users },
                  { href: '/super-admin/settings',     label: 'Settings',            icon: ShieldCheck },
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
