import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { CreateUniversityForm } from './CreateUniversityForm'
import { Building2 } from 'lucide-react'

export const metadata = { title: 'Universities — OEMS' }

export default async function SuperAdminUniversitiesPage() {
  await requireRole('super_admin')
  const supabase = await createClient()

  const { data: universities } = await supabase
    .from('universities')
    .select('id, name, subdomain, created_at')
    .order('name')

  // Count users per university
  const uniIds = (universities ?? []).map(u => u.id)
  const { data: userCounts } = uniIds.length
    ? await supabase
        .from('users')
        .select('university_id, role')
        .in('university_id', uniIds)
    : { data: [] }

  const countMap = {}
  for (const u of userCounts ?? []) {
    if (!countMap[u.university_id]) countMap[u.university_id] = { total: 0, students: 0, lecturers: 0 }
    countMap[u.university_id].total++
    if (u.role === 'student') countMap[u.university_id].students++
    if (u.role === 'lecturer') countMap[u.university_id].lecturers++
  }

  return (
    <>
      <TopBar
        title="Universities"
        subtitle={`${universities?.length ?? 0} institution${universities?.length !== 1 ? 's' : ''} on the platform`}
      />
      <main className="flex-1 p-6 max-w-4xl space-y-6">
        <CreateUniversityForm />

        {!universities?.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
            <Building2 size={32} className="text-text-muted mb-3" />
            <p className="text-sm font-medium text-text-primary mb-1">No universities yet</p>
            <p className="text-xs text-text-muted">Add your first institution above.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {universities.map(uni => {
              const counts = countMap[uni.id] ?? { total: 0, students: 0, lecturers: 0 }
              return (
                <div key={uni.id} className="bg-surface border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-primary-light shrink-0">
                      <Building2 size={18} className="text-primary" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">{uni.name}</p>
                      <p className="text-xs font-mono text-text-muted">{uni.subdomain}.oems.edu</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-center shrink-0">
                    <div>
                      <p className="text-lg font-bold text-text-primary tabular-nums">{counts.lecturers}</p>
                      <p className="text-xs text-text-muted">Lecturers</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-text-primary tabular-nums">{counts.students}</p>
                      <p className="text-xs text-text-muted">Students</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-text-primary tabular-nums">{counts.total}</p>
                      <p className="text-xs text-text-muted">Total Users</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}
