import { readStudentSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/client'
import { CheckResultForm } from './CheckResultForm'
import { EndSessionButton } from './EndSessionButton'

export const metadata = { title: 'Check Result — PCU CBT' }

export default async function CheckResultPage() {
  const session = await readStudentSession()
  const isResultLookupSession = session?.channel === 'result_lookup'

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

  // Real released results, read directly — this one query, used only here,
  // doesn't earn a repository module (Slice 5/6 will introduce a proper
  // results repo when they build the full results dashboard).
  const results = await prisma.result.findMany({
    where: { student_id: session.user.id, released_at: { not: null } },
    select: { final_score: true, passed: true, exam: { select: { title: true } } },
    orderBy: { created_at: 'desc' },
  })

  return (
    <div className="flex-1 px-4 py-16">
      <div className="max-w-sm mx-auto text-center">
        <h1 className="text-xl font-bold text-text-primary mb-6">Your Results</h1>
        {results.length === 0 ? (
          <p className="text-sm text-text-muted mb-8">No released results yet.</p>
        ) : (
          <ul className="space-y-3 mb-8 text-left">
            {results.map((r, i) => (
              <li key={i} className="bg-surface border border-border rounded-xl p-4">
                <p className="text-sm font-semibold text-text-primary">{r.exam.title}</p>
                <p className="text-sm text-text-secondary">
                  Score: {r.final_score} · {r.passed ? 'Passed' : 'Not passed'}
                </p>
              </li>
            ))}
          </ul>
        )}
        <EndSessionButton />
      </div>
    </div>
  )
}
