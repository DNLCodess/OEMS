import { CheckCircle2, XCircle, BarChart2 } from 'lucide-react'

// Deliberately minimal: no trend indicators, no per-course averages, no
// browsing into other exams — just what a matric+DOB lookup is for. Shared
// between the generic /check-result and the university-scoped
// /check-result/{slug}, which otherwise have identical "verified, show
// results" rendering.
export function ResultsList({ user, results }) {
  return (
    <div className="w-full max-w-lg mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">
          {user.full_name}
        </h1>
        <p className="font-mono text-xs text-text-muted mt-1">{user.matric_number}</p>
      </div>

      {results.length === 0 ? (
        <div className="text-center py-12">
          <BarChart2 size={32} className="mx-auto mb-3 text-text-muted" />
          <p className="text-sm text-text-secondary">No submitted exams found for this student yet.</p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {results.map((r, i) => (
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
    </div>
  )
}
