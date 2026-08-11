import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { Users } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { SuperAdminUserActions } from './SuperAdminUserActions'

export const metadata = { title: 'All Users — OEMS' }

const ROLE_LABELS = {
  super_admin:  'Platform Admin',
  school_admin: 'Exam Officer',
  lecturer:     'Lecturer',
  student:      'Student',
}

const ROLE_COLORS = {
  super_admin:  'bg-purple-100 text-purple-700',
  school_admin: 'bg-primary-light text-primary',
  lecturer:     'bg-warning-light text-warning',
  student:      'bg-success-light text-success',
}

export default async function SuperAdminUsersPage() {
  const user     = await requireRole('super_admin')
  const supabase = await createClient()

  const { data: users } = await supabase
    .from('users')
    .select('id, full_name, email, role, matric_number, is_active, removed_at, created_at, universities ( name )')
    .neq('id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <>
      <TopBar
        title="All Users"
        subtitle={`${users?.length ?? 0} users across the platform`}
      />
      <main className="flex-1 p-6">
        {!users?.length ? (
          <EmptyState icon={Users} title="No users yet" description="Users appear here once universities are set up." />
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-page">
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Name</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden sm:table-cell">Email</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Role</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden md:table-cell">University</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map(u => (
                  <tr key={u.id} className={u.is_active ? 'hover:bg-slate-50' : 'opacity-60 hover:bg-slate-50'}>
                    <td className="px-4 py-3 font-medium text-text-primary">
                      {u.full_name}
                      {u.matric_number && (
                        <span className="block font-mono text-xs text-text-muted">{u.matric_number}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-secondary hidden sm:table-cell">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[u.role] ?? 'bg-slate-100 text-slate-600'}`}>
                        {ROLE_LABELS[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs hidden md:table-cell">
                      {u.universities?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {u.removed_at ? (
                        <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-danger-light text-danger">
                          Removed
                        </span>
                      ) : (
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                          u.is_active ? 'bg-success-light text-success' : 'bg-slate-100 text-text-muted'
                        }`}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!u.removed_at && (
                        <SuperAdminUserActions userId={u.id} userName={u.full_name} isActive={u.is_active} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  )
}
