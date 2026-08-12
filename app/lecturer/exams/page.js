import Link from 'next/link'
import { Plus, BookOpen } from 'lucide-react'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { ExamCard } from '@/components/exams/ExamCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
import { Button } from '@/components/ui/Button'

export const metadata = { title: 'My Exams' }

const STATUS_TABS = [
  { value: '',          label: 'All'       },
  { value: 'draft',     label: 'Draft'     },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'live',      label: 'Live'      },
  { value: 'closed',    label: 'Closed'    },
]

export default async function ExamsPage({ searchParams }) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()
  const { status } = await searchParams

  let query = supabase
    .from('exams')
    .select(`
      id, title, status, exam_type, academic_session, semester,
      duration_minutes, created_at,
      courses ( course_code ),
      exam_questions ( marks )
    `)
    .eq('university_id', user.university_id)
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data: exams, error } = await query
  if (error) console.error('[ExamsPage]', error)

  const enriched = (exams ?? []).map(exam => ({
    ...exam,
    course_code:    exam.courses?.course_code ?? '—',
    question_count: exam.exam_questions?.length ?? 0,
    total_marks:    exam.exam_questions?.reduce((s, q) => s + (q.marks ?? 0), 0) ?? 0,
  }))

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Exams</h1>
          <p className="text-sm text-text-secondary mt-1">Create and manage your examinations.</p>
        </div>
        <Link href="/lecturer/exams/new">
          <Button>
            <Plus size={16} />
            New Exam
          </Button>
        </Link>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-border">
        {STATUS_TABS.map(tab => {
          const isActive = (status ?? '') === tab.value
          return (
            <Link
              key={tab.value}
              href={tab.value ? `/lecturer/exams?status=${tab.value}` : '/lecturer/exams'}
              className={[
                'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary',
              ].join(' ')}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      {/* Content */}
      {error ? (
        <QueryErrorBanner message="Failed to load exams. Please refresh." />
      ) : enriched.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={status ? `No ${status} exams` : 'No exams yet'}
          description={
            status
              ? 'Try a different status filter.'
              : 'Create your first exam to get started.'
          }
          action={
            !status && (
              <Link href="/lecturer/exams/new">
                <Button>Create your first exam</Button>
              </Link>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {enriched.map(exam => (
            <ExamCard key={exam.id} exam={exam} />
          ))}
        </div>
      )}
    </div>
  )
}
