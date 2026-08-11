import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { ExamSettingsForm } from '@/components/exams/ExamSettingsForm'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'

export const metadata = { title: 'New Exam' }

export default async function NewExamPage() {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()

  const { data: courses } = await supabase
    .from('courses')
    .select('id, course_code, course_title, level')
    .eq('university_id', user.university_id)
    .order('course_code')

  if (!courses || courses.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={BookOpen}
          title="No courses available"
          description="Your Exam Officer needs to set up courses before you can create an exam."
          action={
            <Link href="/lecturer/exams">
              <Button variant="secondary">Back to Exams</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="mb-8">
        <Link
          href="/lecturer/exams"
          className="text-sm text-text-muted hover:text-primary transition-colors"
        >
          ← Exams
        </Link>
        <h1 className="text-2xl font-bold text-text-primary tracking-tight mt-2">New Exam</h1>
        <p className="text-sm text-text-secondary mt-1">
          Set up the details. You can add questions after creating the exam.
        </p>
      </div>

      <ExamSettingsForm courses={courses} lecturerId={user.id} />
    </div>
  )
}
