import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CheckResultForm } from '../CheckResultForm'
import { CheckAnotherResultButton } from '../CheckAnotherResultButton'
import { ResultsList } from '@/components/student/ResultsList'
import { UniversityBadge } from '@/components/shared/UniversityBadge'
import { getUniversityThemeStyle } from '@/lib/universityTheme'

export const metadata = { title: 'Check Result — OEMS' }

export default async function UniversityCheckResultPage({ params }) {
  const { slug } = await params
  const adminClient = createAdminClient()
  const { data: university } = await adminClient
    .from('universities')
    .select('id, name, logo_url, primary_color')
    .eq('subdomain', slug.toLowerCase())
    .maybeSingle()

  if (!university) notFound()

  const themeStyle = getUniversityThemeStyle(university)
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()

  const isResultLookupSession = authUser?.app_metadata?.session_channel === 'result_lookup'

  if (!isResultLookupSession) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-16" style={themeStyle}>
        <div className="w-full max-w-sm">
          <UniversityBadge university={university} />
          <div className="text-center mb-10">
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">Check Your Result</h1>
            <p className="text-sm text-text-muted mt-1">
              Enter your matric number and date of birth
            </p>
          </div>
          <CheckResultForm universitySlug={slug.toLowerCase()} />
        </div>
      </div>
    )
  }

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
    <div className="flex-1 px-4 py-16" style={themeStyle}>
      <UniversityBadge university={university} />
      <ResultsList user={user} results={enriched} />
      <div className="text-center">
        <CheckAnotherResultButton returnTo={`/check-result/${slug.toLowerCase()}`} />
      </div>
    </div>
  )
}
