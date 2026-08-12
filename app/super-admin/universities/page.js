import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { CreateUniversityForm } from './CreateUniversityForm'
import { UniversityRow } from './UniversityRow'
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
import { Building2 } from 'lucide-react'

export const metadata = { title: 'Universities — OEMS' }

export default async function SuperAdminUniversitiesPage() {
  await requireRole('super_admin')
  const supabase = await createClient()

  const { data: universities, error: universitiesError } = await supabase
    .from('universities')
    .select('id, name, subdomain, primary_color, logo_url, created_at')
    .order('name')
  if (universitiesError) console.error('[SuperAdminUniversitiesPage]', universitiesError)

  // Count users per university
  const uniIds = (universities ?? []).map(u => u.id)
  const { data: userCounts, error: userCountsError } = uniIds.length
    ? await supabase
        .from('users')
        .select('university_id, role')
        .in('university_id', uniIds)
    : { data: [] }
  if (userCountsError) console.error('[SuperAdminUniversitiesPage]', userCountsError)

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

        {universitiesError ? (
          <QueryErrorBanner message="Failed to load universities. Please refresh." />
        ) : !universities?.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
            <Building2 size={32} className="text-text-muted mb-3" />
            <p className="text-sm font-medium text-text-primary mb-1">No universities yet</p>
            <p className="text-xs text-text-muted">Add your first institution above.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {userCountsError && (
              <QueryErrorBanner message="Failed to load user counts. Please refresh." />
            )}
            <div className="grid gap-4">
              {universities.map(uni => (
                <UniversityRow
                  key={uni.id}
                  university={uni}
                  counts={countMap[uni.id] ?? { total: 0, students: 0, lecturers: 0 }}
                  countsUnavailable={!!userCountsError}
                />
              ))}
            </div>
          </div>
        )}
      </main>
    </>
  )
}
