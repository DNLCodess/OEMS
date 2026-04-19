import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { CreateCourseForm } from './CreateCourseForm'
import { BookOpen } from 'lucide-react'

export const metadata = { title: 'Courses — OEMS' }

const LEVEL_LABELS = { '100': '100L', '200': '200L', '300': '300L', '400': '400L', '500': '500L', PG: 'PG' }

export default async function AdminCoursesPage() {
  const user     = await requireRole('school_admin')
  const supabase = await createClient()

  const [{ data: courses }, { data: departments }] = await Promise.all([
    supabase
      .from('courses')
      .select('id, course_code, course_title, credit_units, level, semester, departments ( name, faculties ( name ) )')
      .eq('university_id', user.university_id)
      .order('course_code'),
    supabase
      .from('departments')
      .select('id, name')
      .eq('university_id', user.university_id)
      .order('name'),
  ])

  return (
    <>
      <TopBar
        title="Courses"
        subtitle={`${courses?.length ?? 0} courses registered`}
      />
      <main className="flex-1 p-6 max-w-5xl space-y-6">
        <CreateCourseForm departments={departments ?? []} />

        {!courses?.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
            <BookOpen size={32} className="text-text-muted mb-3" />
            <p className="text-sm font-medium text-text-primary mb-1">No courses yet</p>
            <p className="text-xs text-text-muted">Add your first course using the form above.</p>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-page">
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Code</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Title</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden md:table-cell">Department</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Level</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden sm:table-cell">Semester</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden lg:table-cell">Units</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {courses.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-medium text-primary bg-primary-light px-2 py-0.5 rounded">
                        {c.course_code}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-primary font-medium">{c.course_title}</td>
                    <td className="px-4 py-3 text-text-secondary hidden md:table-cell">
                      <div>{c.departments?.name}</div>
                      <div className="text-xs text-text-muted">{c.departments?.faculties?.name}</div>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{LEVEL_LABELS[c.level] ?? c.level}</td>
                    <td className="px-4 py-3 text-text-secondary capitalize hidden sm:table-cell">{c.semester}</td>
                    <td className="px-4 py-3 text-text-muted hidden lg:table-cell">{c.credit_units}</td>
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
