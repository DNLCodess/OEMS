import Link from 'next/link'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { QuestionForm } from '@/components/questions/QuestionForm'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { BookOpen } from 'lucide-react'

export const metadata = { title: 'New Question' }

export default async function NewQuestionPage() {
  const user = await requireRole('lecturer')
  const supabase = await createClient()

  const { data: courses } = await supabase
    .from('courses')
    .select('id, course_code, course_title, level')
    .eq('university_id', user.university_id)
    .order('course_code')

  // Can't create a question without a course to attach it to
  if (!courses || courses.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={BookOpen}
          title="No courses available"
          description="Your Exam Officer needs to set up courses before you can create questions."
          action={
            <Link href="/lecturer/questions">
              <Button variant="secondary">Back to question bank</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return <QuestionForm courses={courses} />
}
