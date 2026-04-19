import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { Badge } from '@/components/ui/Badge'
import { InviteUserModal } from './InviteUserModal'
import { ToggleActiveButton } from './ToggleActiveButton'

export const metadata = { title: 'Users — OEMS' }

const ROLE_LABELS = {
  school_admin: 'Exam Officer',
  lecturer:     'Lecturer',
  student:      'Student',
}

export default async function AdminUsersPage() {
  const user     = await requireRole('school_admin')
  const supabase = await createClient()

  const [{ data: users }, { data: faculties }, { data: departments }] = await Promise.all([
    supabase
      .from('users')
      .select('id, full_name, email, role, matric_number, level, is_active, created_at, departments ( name )')
      .eq('university_id', user.university_id)
      .neq('id', user.id)
      .order('role')
      .order('full_name'),
    supabase
      .from('faculties')
      .select('id, name')
      .eq('university_id', user.university_id)
      .order('name'),
    supabase
      .from('departments')
      .select('id, name, faculties ( name )')
      .eq('university_id', user.university_id)
      .order('name'),
  ])

  const grouped = {
    school_admin: [],
    lecturer:     [],
    student:      [],
  }
  for (const u of users ?? []) {
    if (grouped[u.role]) grouped[u.role].push(u)
  }

  return (
    <>
      <TopBar
        title="User Management"
        subtitle="Invite and manage lecturers, students, and exam officers"
        actions={
          <InviteUserModal
            faculties={faculties ?? []}
            departments={departments ?? []}
          />
        }
      />
      <main className="flex-1 p-6 space-y-8">
        {Object.entries(grouped).map(([role, roleUsers]) => (
          <section key={role}>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-text-primary">{ROLE_LABELS[role]}s</h2>
              <span className="text-xs text-text-muted bg-page border border-border rounded-full px-2 py-0.5">
                {roleUsers.length}
              </span>
            </div>

            {roleUsers.length === 0 ? (
              <p className="text-sm text-text-muted py-4 text-center border border-dashed border-border rounded-xl">
                No {ROLE_LABELS[role].toLowerCase()}s yet.
              </p>
            ) : (
              <div className="bg-surface border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-page">
                      <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Name</th>
                      <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden sm:table-cell">Email</th>
                      {role === 'student' && (
                        <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden md:table-cell">Matric / Level</th>
                      )}
                      <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden lg:table-cell">Department</th>
                      <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {roleUsers.map(u => (
                      <tr key={u.id} className={u.is_active ? '' : 'opacity-60'}>
                        <td className="px-4 py-3 font-medium text-text-primary">{u.full_name}</td>
                        <td className="px-4 py-3 text-text-secondary hidden sm:table-cell">{u.email}</td>
                        {role === 'student' && (
                          <td className="px-4 py-3 hidden md:table-cell">
                            <span className="font-mono text-xs text-text-secondary">{u.matric_number}</span>
                            {u.level && <span className="text-xs text-text-muted ml-2">{u.level}L</span>}
                          </td>
                        )}
                        <td className="px-4 py-3 text-text-muted text-xs hidden lg:table-cell">
                          {u.departments?.name ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                            u.is_active
                              ? 'bg-success-light text-success'
                              : 'bg-slate-100 text-text-muted'
                          }`}>
                            {u.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ToggleActiveButton userId={u.id} isActive={u.is_active} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </main>
    </>
  )
}
