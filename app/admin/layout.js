import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/shared/Sidebar'
import { getUniversityThemeStyle } from '@/lib/universityTheme'

export default async function AdminLayout({ children }) {
  const user     = await requireRole('school_admin')
  const supabase = await createClient()

  const { data: university } = await supabase
    .from('universities')
    .select('primary_color, logo_url')
    .eq('id', user.university_id)
    .maybeSingle()

  return (
    <div className="flex h-screen overflow-hidden" style={getUniversityThemeStyle(university)}>
      <Sidebar user={user} logoUrl={university?.logo_url} />
      <div className="flex flex-col flex-1 min-w-0 overflow-y-auto pt-14 md:pt-0">
        {children}
      </div>
    </div>
  )
}
