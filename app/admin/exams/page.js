import Link from 'next/link'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ClipboardList } from 'lucide-react'
import { EXAM_TYPE_LABELS } from '@/lib/utils'

export const metadata = { title: 'Exam Oversight — OEMS' }

export default async function AdminExamsPage() {
  const user     = await requireRole('school_admin')
  const supabase = await createClient()

  const { data: exams } = await supabase
    .from('exams')
    .select(`
      id, title, status, exam_type, academic_session, semester, start_at,
      courses ( course_code ),
      users:created_by ( full_name ),
      exam_questions ( id )
    `)
    .eq('university_id', user.university_id)
    .order('created_at', { ascending: false })

  // Count attempts per exam
  const examIds = (exams ?? []).map(e => e.id)
  const { data: attemptCounts } = examIds.length
    ? await supabase
        .from('attempts')
        .select('exam_id')
        .in('exam_id', examIds)
        .in('status', ['submitted', 'graded'])
    : { data: [] }

  const countMap = {}
  for (const a of attemptCounts ?? []) {
    countMap[a.exam_id] = (countMap[a.exam_id] ?? 0) + 1
  }

  return (
    <>
      <TopBar
        title="Exam Oversight"
        subtitle="Read-only view of all exams across your institution"
      />
      <main className="flex-1 p-6">
        {!exams?.length ? (
          <EmptyState
            icon={ClipboardList}
            title="No exams yet"
            description="Exams created by lecturers will appear here."
          />
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-page">
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Exam</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden sm:table-cell">Lecturer</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3 hidden md:table-cell">Type</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Status</th>
                  <th className="text-right text-xs font-medium text-text-muted px-4 py-3 hidden lg:table-cell">Submissions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {exams.map(exam => (
                  <tr key={exam.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                          {exam.courses?.course_code}
                        </span>
                        <span className="text-text-primary font-medium truncate max-w-xs">{exam.title}</span>
                      </div>
                      <div className="text-xs text-text-muted mt-0.5 ml-0">
                        {exam.academic_session} · {exam.semester === 'first' ? '1st' : '2nd'} Semester
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-secondary hidden sm:table-cell">
                      {exam.users?.full_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-text-muted">{EXAM_TYPE_LABELS[exam.exam_type] ?? exam.exam_type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={exam.status} />
                    </td>
                    <td className="px-4 py-3 text-right text-text-secondary hidden lg:table-cell">
                      {countMap[exam.id] ?? 0}
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
