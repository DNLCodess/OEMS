import Link from 'next/link'
import { Plus, FileQuestion } from 'lucide-react'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { QuestionCard } from '@/components/questions/QuestionCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
import { Button } from '@/components/ui/Button'
import { QuestionsFilters } from './QuestionsFilters'

export const metadata = { title: 'Question Bank' }

export default async function QuestionsPage({ searchParams }) {
  const user = await requireRole('lecturer')
  const supabase = await createClient()

  const params = await searchParams
  const { course: courseId, type, difficulty, q: search } = params

  // Fetch all courses in this university for the filter bar
  const { data: courses } = await supabase
    .from('courses')
    .select('id, course_code, course_title')
    .eq('university_id', user.university_id)
    .order('course_code')

  // Fetch questions with filters
  let query = supabase
    .from('question_bank')
    .select('id, body, type, difficulty, tags, created_at, is_archived, course_id, courses!course_id(course_code, course_title)')
    .eq('university_id', user.university_id)
    .eq('created_by', user.id)
    .eq('is_archived', false)
    .order('created_at', { ascending: false })

  if (courseId)   query = query.eq('course_id', courseId)
  if (type)       query = query.eq('type', type)
  if (difficulty) query = query.eq('difficulty', difficulty)
  if (search)     query = query.ilike('body', `%${search}%`)

  const { data: questions, error } = await query
  if (error) console.error('[QuestionsPage]', error)

  const addAction = (
    <Link href="/lecturer/questions/new">
      <Button size="sm">
        <Plus className="size-4" />
        Add question
      </Button>
    </Link>
  )

  return (
    <>
      <TopBar
        title="Question Bank"
        subtitle={questions?.length ? `${questions.length} question${questions.length !== 1 ? 's' : ''}` : undefined}
        actions={addAction}
      />
      <main className="flex-1 p-6 space-y-5">
        <QuestionsFilters courses={courses ?? []} />

        {error && <QueryErrorBanner message="Failed to load questions. Please refresh." />}

        {!error && questions?.length === 0 && (
          <EmptyState
            icon={FileQuestion}
            title="No questions yet"
            description={
              courseId || type || difficulty || search
                ? 'No questions match your filters. Try adjusting them.'
                : 'Start building your question bank. Questions you create here can be added to any exam.'
            }
            action={
              !courseId && !type && !difficulty && !search
                ? <Link href="/lecturer/questions/new"><Button>Add your first question</Button></Link>
                : undefined
            }
          />
        )}

        {!error && questions?.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {questions.map(q => (
              <QuestionCard key={q.id} question={q} />
            ))}
          </div>
        )}
      </main>
    </>
  )
}
