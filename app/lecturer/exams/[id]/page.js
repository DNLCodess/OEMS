import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Settings, Eye, BarChart2, Calculator, Lightbulb, Camera, Monitor } from 'lucide-react'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { ExamBuilder } from '@/components/exams/ExamBuilder'
import { WorkflowPanel } from '@/components/exams/WorkflowPanel'
import { AccessCodePanel } from '@/components/exams/AccessCodePanel'
import { ExamAccessPanel } from '@/components/exams/ExamAccessPanel'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'

export async function generateMetadata({ params }) {
  return { title: 'Exam Builder' }
}

export default async function ExamDetailPage({ params }) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()
  const { id }   = await params

  const [
    { data: exam, error: examError },
    { data: examQuestions, error: examQuestionsError },
    { data: bankQuestions, error: bankQuestionsError },
    { data: examAccess, error: examAccessError },
  ] = await Promise.all([
    supabase
      .from('exams')
      .select(`
        id, title, status, exam_type, academic_session, semester,
        duration_minutes, pass_mark, instructions,
        randomise_questions, randomise_options, created_by,
        exam_mode, access_code, proctoring_enabled, show_calculator, tips,
        courses!course_id ( course_code, course_title )
      `)
      .eq('id', id)
      .eq('university_id', user.university_id)
      .single(),

    supabase
      .from('exam_questions')
      .select(`
        id, exam_id, question_id, order_index, marks,
        question_bank:question_id (
          id, type, body, difficulty, course_id,
          courses:course_id ( course_code )
        )
      `)
      .eq('exam_id', id)
      .order('order_index'),

    supabase
      .from('question_bank')
      .select('id, type, body, difficulty, course_id, courses:course_id ( course_code )')
      .eq('university_id', user.university_id)
      .eq('is_archived', false)
      .order('created_at', { ascending: false }),

    supabase
      .from('exam_access')
      .select('users:user_id ( id, full_name, matric_number )')
      .eq('exam_id', id),
  ])

  if (examError) {
    console.error('[ExamDetailPage]', examError)
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <Link href="/lecturer/exams" className="text-sm text-text-muted hover:text-primary transition-colors">
          ← Exams
        </Link>
        <div className="mt-4">
          <QueryErrorBanner message="Failed to load this exam. Please refresh." />
        </div>
      </div>
    )
  }

  if (!exam || exam.created_by !== user.id) notFound()

  const secondaryError = examQuestionsError || bankQuestionsError || examAccessError
  if (secondaryError) console.error('[ExamDetailPage]', secondaryError)

  const isEditable = exam.status !== 'live' && exam.status !== 'closed'

  const EXAM_TYPE_LABELS = {
    ca:              'C.A.',
    mid_semester:    'Mid-Semester',
    end_of_semester: 'End of Semester',
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Back nav */}
      <Link
        href="/lecturer/exams"
        className="text-sm text-text-muted hover:text-primary transition-colors"
      >
        ← Exams
      </Link>

      {/* Page header */}
      <div className="flex items-start justify-between gap-4 mt-2 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">{exam.title}</h1>
            <Badge variant={exam.status} />
          </div>
          <p className="text-sm text-text-secondary">
            <span className="font-mono">{exam.courses?.course_code}</span>
            {' · '}
            {EXAM_TYPE_LABELS[exam.exam_type] ?? exam.exam_type}
            {' · '}
            {exam.academic_session}, {exam.semester === 'first' ? '1st' : '2nd'} Semester
            {' · '}
            {exam.duration_minutes} min
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link href={`/lecturer/exams/${id}/preview`}>
            <Button variant="secondary">
              <Eye size={15} />
              Preview
            </Button>
          </Link>
          {!isEditable && (
            <Link href={`/lecturer/exams/${id}/results`}>
              <Button variant="secondary">
                <BarChart2 size={15} />
                Results
              </Button>
            </Link>
          )}
          {isEditable && (
            <Link href={`/lecturer/exams/${id}/edit`}>
              <Button variant="secondary">
                <Settings size={15} />
                Settings
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main — question builder */}
        <div className="lg:col-span-2">
          <h2 className="text-base font-semibold text-text-primary mb-4">Questions</h2>
          {secondaryError && (
            <div className="mb-4">
              <QueryErrorBanner message="Some exam data failed to load. Please refresh." />
            </div>
          )}
          <ExamBuilder
            examId={id}
            initialQuestions={examQuestions ?? []}
            bankQuestions={bankQuestions ?? []}
            readOnly={!isEditable}
          />
        </div>

        {/* Sidebar — workflow + info */}
        <div className="space-y-4">
          <WorkflowPanel examId={id} currentStatus={exam.status} />

          <AccessCodePanel
            examId={id}
            accessCode={exam.access_code}
            examStatus={exam.status}
          />

          <ExamAccessPanel
            examId={id}
            initialRestricted={(examAccess ?? []).map(row => row.users).filter(Boolean)}
            examStatus={exam.status}
          />

          {/* Exam info card */}
          <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-text-primary">Details</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-text-muted">Delivery mode</dt>
                <dd className="flex items-center gap-1.5 text-text-primary capitalize">
                  {exam.exam_mode === 'lab' && <Monitor size={12} className="text-primary" />}
                  {exam.exam_mode ?? 'remote'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-muted">Pass mark</dt>
                <dd className="font-medium text-text-primary">{exam.pass_mark}%</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-muted">Randomise questions</dt>
                <dd className="text-text-primary">{exam.randomise_questions ? 'Yes' : 'No'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-muted">Randomise options</dt>
                <dd className="text-text-primary">{exam.randomise_options ? 'Yes' : 'No'}</dd>
              </div>
            </dl>

            {/* Active features */}
            {(exam.show_calculator || exam.proctoring_enabled || exam.tips?.length > 0) && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-text-muted mb-2">Active features</p>
                <div className="flex flex-wrap gap-2">
                  {exam.show_calculator && (
                    <span className="flex items-center gap-1 text-xs bg-primary-light text-primary px-2 py-1 rounded-lg">
                      <Calculator size={11} /> Calculator
                    </span>
                  )}
                  {exam.tips?.length > 0 && (
                    <span className="flex items-center gap-1 text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded-lg">
                      <Lightbulb size={11} /> {exam.tips.length} tip{exam.tips.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {exam.proctoring_enabled && (
                    <span className="flex items-center gap-1 text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded-lg">
                      <Camera size={11} /> Proctoring
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {exam.instructions && (
            <div className="bg-surface border border-border rounded-xl p-5">
              <h3 className="text-sm font-semibold text-text-primary mb-2">Instructions</h3>
              <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">
                {exam.instructions}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
