import { requireRole } from '@/lib/dal'
import { listStaffAndStudents } from '@/lib/db/repositories/users'
import { listFaculties, listDepartments } from '@/lib/db/repositories/structure'
import { TopBar } from '@/components/shared/TopBar'
import { InviteUserModal } from './InviteUserModal'
import { BulkUploadStudentsModal } from './BulkUploadStudentsModal'
import { ToggleActiveButton } from './ToggleActiveButton'
import { RemoveUserButton } from './RemoveUserButton'

export const metadata = { title: 'Users — PCU CBT' }

const ROLE_LABELS = {
  super_admin:  'Platform Admin',
  school_admin: 'Exam Officer',
  lecturer:     'Lecturer',
  student:      'Student',
}

export default async function AdminUsersPage() {
  const user = await requireRole('school_admin', 'super_admin')

  const [users, faculties, departments] = await Promise.all([
    listStaffAndStudents({ excludeUserId: user.id }),
    listFaculties(),
    listDepartments(),
  ])

  const grouped = { super_admin: [], school_admin: [], lecturer: [], student: [] }
  for (const u of users) {
    if (grouped[u.role]) grouped[u.role].push(u)
  }

  return (
    <>
      <TopBar
        title="User Management"
        subtitle="Invite and manage lecturers, students, and exam officers"
        actions={
          <div className="flex items-center gap-2">
            <BulkUploadStudentsModal faculties={faculties} departments={departments} />
            <InviteUserModal faculties={faculties} departments={departments} />
          </div>
        }
      />
      <main className="flex-1 p-6 space-y-8">
        {Object.entries(grouped).map(([role, roleUsers]) => (
          roleUsers.length === 0 && role === 'super_admin' ? null : (
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
                          <td className="px-4 py-3 text-text-secondary hidden sm:table-cell">
                            {role === 'student'
                              ? <span className="text-text-muted italic">No email (matric login)</span>
                              : u.email}
                          </td>
                          {role === 'student' && (
                            <td className="px-4 py-3 hidden md:table-cell">
                              <span className="font-mono text-xs text-text-secondary">{u.matric_number}</span>
                              {u.level && <span className="text-xs text-text-muted ml-2">{u.level}L</span>}
                            </td>
                          )}
                          <td className="px-4 py-3 text-text-muted text-xs hidden lg:table-cell">
                            {u.department?.name ?? '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                              u.is_active ? 'bg-success-light text-success' : 'bg-slate-100 text-text-muted'
                            }`}>
                              {u.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <ToggleActiveButton userId={u.id} isActive={u.is_active} />
                            <RemoveUserButton userId={u.id} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )
        ))}
      </main>
    </>
  )
}
