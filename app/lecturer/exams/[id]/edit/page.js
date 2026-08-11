import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { ExamSettingsForm } from '@/components/exams/ExamSettingsForm'

export const metadata = { title: 'Edit Exam Settings' }

export default async function EditExamPage({ params }) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()
  const { id }   = await params

  const [{ data: exam }, { data: courses }] = await Promise.all([
    supabase
      .from('exams')
      .select('*')
      .eq('id', id)
      .eq('university_id', user.university_id)
      .single(),

    supabase
      .from('courses')
      .select('id, course_code, course_title, level')
      .eq('university_id', user.university_id)
      .order('course_code'),
  ])

  if (!exam || exam.created_by !== user.id) notFound()

  if (exam.status === 'closed') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Link href={`/lecturer/exams/${id}`} className="text-sm text-text-muted hover:text-primary transition-colors">
          ← Back to Exam
        </Link>
        <div className="mt-8 bg-surface border border-border rounded-xl p-8 text-center">
          <p className="text-text-secondary">Closed exams cannot be edited.</p>
          <Link href={`/lecturer/exams/${id}`} className="text-sm text-primary hover:underline mt-3 inline-block">
            Return to exam →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="mb-8">
        <Link
          href={`/lecturer/exams/${id}`}
          className="text-sm text-text-muted hover:text-primary transition-colors"
        >
          ← Back to Exam
        </Link>
        <h1 className="text-2xl font-bold text-text-primary tracking-tight mt-2">Edit Settings</h1>
        <p className="text-sm text-text-secondary mt-1">{exam.title}</p>
      </div>

      <ExamSettingsForm courses={courses ?? []} exam={exam} lecturerId={user.id} />
    </div>
  )
}
