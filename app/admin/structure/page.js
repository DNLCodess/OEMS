import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { CreateFacultyForm, CreateDepartmentForm } from './StructureForms'
import { Building2, ChevronRight } from 'lucide-react'

export const metadata = { title: 'Faculties & Departments — OEMS' }

export default async function AdminStructurePage() {
  const user     = await requireRole('school_admin')
  const supabase = await createClient()

  const [{ data: faculties }, { data: departments }] = await Promise.all([
    supabase
      .from('faculties')
      .select('id, name')
      .eq('university_id', user.university_id)
      .order('name'),
    supabase
      .from('departments')
      .select('id, name, faculty_id')
      .eq('university_id', user.university_id)
      .order('name'),
  ])

  // Group departments by faculty
  const deptsByFaculty = {}
  for (const d of departments ?? []) {
    if (!deptsByFaculty[d.faculty_id]) deptsByFaculty[d.faculty_id] = []
    deptsByFaculty[d.faculty_id].push(d)
  }

  return (
    <>
      <TopBar
        title="Faculties & Departments"
        subtitle="Define your institution's academic structure"
      />
      <main className="flex-1 p-6">
        <div className="max-w-4xl grid lg:grid-cols-3 gap-6">

          {/* Actions column */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-text-primary mb-3">Add Structure</h2>
            <CreateFacultyForm />
            <CreateDepartmentForm faculties={faculties ?? []} />
          </div>

          {/* Structure tree */}
          <div className="lg:col-span-2">
            <h2 className="text-sm font-semibold text-text-primary mb-3">
              Current Structure
              <span className="ml-2 text-xs font-normal text-text-muted">
                {faculties?.length ?? 0} {faculties?.length === 1 ? 'faculty' : 'faculties'} · {departments?.length ?? 0} departments
              </span>
            </h2>

            {!faculties?.length ? (
              <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
                <Building2 size={32} className="text-text-muted mb-3" />
                <p className="text-sm font-medium text-text-primary mb-1">No structure yet</p>
                <p className="text-xs text-text-muted">Add your first faculty to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {faculties.map(faculty => (
                  <div key={faculty.id} className="bg-surface border border-border rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 bg-primary-light border-b border-primary/10">
                      <Building2 size={15} className="text-primary shrink-0" />
                      <span className="text-sm font-semibold text-primary">{faculty.name}</span>
                    </div>
                    {(deptsByFaculty[faculty.id] ?? []).length === 0 ? (
                      <p className="text-xs text-text-muted px-4 py-3">No departments yet.</p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {(deptsByFaculty[faculty.id] ?? []).map(dept => (
                          <li key={dept.id} className="flex items-center gap-2 px-4 py-2.5">
                            <ChevronRight size={13} className="text-text-muted shrink-0" />
                            <span className="text-sm text-text-primary">{dept.name}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
