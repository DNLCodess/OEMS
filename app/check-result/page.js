import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { CheckResultForm } from './CheckResultForm'
import { CheckAnotherResultButton } from './CheckAnotherResultButton'
import { ResultsList } from '@/components/student/ResultsList'

export const metadata = { title: 'Check Result — PCU CBT' }

export default async function CheckResultPage() {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()

  const isResultLookupSession = authUser?.app_metadata?.session_channel === 'result_lookup'

  if (!isResultLookupSession) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm">
          <div className="text-center mb-10">
            <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-primary text-white text-2xl font-bold mb-4">
              O
            </div>
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">Check Your Result</h1>
            <p className="text-sm text-text-muted mt-1">
              Enter your matric number and date of birth
            </p>
          </div>

          <CheckResultForm />
        </div>
      </div>
    )
  }

  // Verified for result lookup — show this student's own results only.
  // Deliberately minimal: no trend indicators, no per-course averages, no
  // browsing into other exams. Just what a matric+DOB lookup is for.
  const user = await requireRole('student')

  const { data: results } = await supabase
    .from('results')
    .select(`
      final_score, passed,
      exams:exam_id (
        id, title, exam_type,
        courses!course_id ( course_code, course_title ),
        exam_questions ( marks )
      ),
      attempts:attempt_id ( submitted_at )
    `)
    .eq('student_id', user.id)
    .order('attempts(submitted_at)', { ascending: false })

  const enriched = (results ?? []).map(r => {
    const totalMarks = (r.exams?.exam_questions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)
    const pct = totalMarks > 0 ? Math.round((r.final_score / totalMarks) * 100) : 0
    return { ...r, totalMarks, pct }
  })

  return (
    <div className="flex-1 px-4 py-16">
      <ResultsList user={user} results={enriched} />
      <div className="text-center">
        <CheckAnotherResultButton />
      </div>
    </div>
  )
}
