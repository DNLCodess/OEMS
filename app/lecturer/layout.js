import { requireRole } from '@/lib/dal'
import { Sidebar } from '@/components/shared/Sidebar'

export default async function LecturerLayout({ children }) {
  const user = await requireRole('lecturer')

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={user} />
      <div className="flex flex-col flex-1 min-w-0 overflow-y-auto pt-14 md:pt-0">
        {children}
      </div>
    </div>
  )
}
