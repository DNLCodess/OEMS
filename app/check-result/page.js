import { CheckCircle2, XCircle, BarChart2 } from 'lucide-react'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { CheckResultForm } from './CheckResultForm'
import { CheckAnotherResultButton } from './CheckAnotherResultButton'

export const metadata = { title: 'Check Result — OEMS' }

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
      <div className="w-full max-w-lg mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">
            {user.full_name}
          </h1>
          <p className="font-mono text-xs text-text-muted mt-1">{user.matric_number}</p>
        </div>

        {enriched.length === 0 ? (
          <div className="text-center py-12">
            <BarChart2 size={32} className="mx-auto mb-3 text-text-muted" />
            <p className="text-sm text-text-secondary">No submitted exams found for this student yet.</p>
          </div>
        ) : (
          <div className="space-y-3 mb-8">
            {enriched.map((r, i) => (
              <div
                key={i}
                className={`bg-surface border rounded-2xl p-4 flex items-center gap-4 ${
                  r.passed ? 'border-success/20' : 'border-danger/20'
                }`}
              >
                <div className="shrink-0 flex flex-col items-center w-14">
                  <div className={`text-lg font-bold tabular-nums ${r.passed ? 'text-success' : 'text-danger'}`}>
                    {r.pct}%
                  </div>
                  {r.passed
                    ? <CheckCircle2 size={14} className="text-success mt-0.5" />
                    : <XCircle     size={14} className="text-danger mt-0.5"  />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-text-muted">{r.exams?.courses?.course_code}</p>
                  <p className="text-sm font-semibold text-text-primary truncate">{r.exams?.title}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold text-text-primary tabular-nums">
                    {r.final_score}<span className="text-xs text-text-muted">/{r.totalMarks}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="text-center">
          <CheckAnotherResultButton />
        </div>
      </div>
    </div>
  )
}
