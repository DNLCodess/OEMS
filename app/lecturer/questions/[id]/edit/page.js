import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { QuestionForm } from '@/components/questions/QuestionForm'
import { Button } from '@/components/ui/Button'

export const metadata = { title: 'Edit Question' }

export default async function EditQuestionPage({ params }) {
  const user = await requireRole('lecturer')
  const supabase = await createClient()

  const { id } = await params

  const [{ data: question }, { data: courses }] = await Promise.all([
    supabase
      .from('question_bank')
      .select('*')
      .eq('id', id)
      .eq('university_id', user.university_id)
      .eq('created_by', user.id)
      .single(),

    supabase
      .from('courses')
      .select('id, course_code, course_title, level')
      .eq('university_id', user.university_id)
      .order('course_code'),
  ])

  if (!question) notFound()

  return <QuestionForm question={question} courses={courses ?? []} />
}
