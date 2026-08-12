import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { ResultsTable } from '@/components/lecturer/ResultsTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'
import { Badge } from '@/components/ui/Badge'
import { Users, TrendingUp, TrendingDown, Award, AlertTriangle } from 'lucide-react'

export const metadata = { title: 'Exam Results' }

export default async function ExamResultsPage({ params }) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()
  const { id }   = await params

  const { data: exam, error: examError } = await supabase
    .from('exams')
    .select('id, title, status, pass_mark, created_by, courses!course_id ( course_code, course_title )')
    .eq('id', id)
    .eq('university_id', user.university_id)
    .single()

  if (examError) {
    console.error('[ExamResultsPage]', examError)
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <Link href={`/lecturer/exams/${id}`} className="text-sm text-text-muted hover:text-primary transition-colors">
          ← Back to Exam
        </Link>
        <div className="mt-4">
          <QueryErrorBanner message="Failed to load results for this exam. Please refresh." />
        </div>
      </div>
    )
  }

  if (!exam || exam.created_by !== user.id) notFound()

  const { data: examQuestions, error: examQuestionsError } = await supabase
    .from('exam_questions')
    .select('marks')
    .eq('exam_id', id)

  const totalPossible = (examQuestions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)

  const { data: attempts, error: attemptsError } = await supabase
    .from('attempts')
    .select('id, status, submitted_at, total_score, users:student_id ( id, full_name, matric_number, level )')
    .eq('exam_id', id)
    .in('status', ['submitted', 'graded'])
    .order('total_score', { ascending: false, nullsFirst: false })

  const { data: results, error: resultsError } = await supabase
    .from('results')
    .select('attempt_id, final_score, passed')
    .eq('exam_id', id)

  const resultMap = new Map((results ?? []).map(r => [r.attempt_id, r]))

  const attemptIds = (attempts ?? []).map(a => a.id)

  // Per-question stats: how many got each question wrong
  const { data: allResponses, error: responsesError } = attemptIds.length
    ? await supabase
        .from('responses')
        .select('question_id, is_correct, marks_awarded')
        .in('attempt_id', attemptIds)
    : { data: [] }

  const dataError = examQuestionsError || attemptsError || resultsError || responsesError
  if (dataError) console.error('[ExamResultsPage]', dataError)

  const rows = (attempts ?? []).map(a => {
    const result  = resultMap.get(a.id)
    const score   = result?.final_score ?? a.total_score ?? 0
    const pct     = totalPossible > 0 ? Math.round((score / totalPossible) * 100) : 0
    return {
      attempt_id:    a.id,
      full_name:     a.users?.full_name ?? 'Unknown',
      matric_number: a.users?.matric_number ?? null,
      level:         a.users?.level ?? null,
      score,
      percentage:    pct,
      passed:        result?.passed ?? null,
    }
  })

  // ── Analytics ───────────────────────────────────────────────────────────────
  const scores       = rows.map(r => r.score)
  const passMarkAbs  = totalPossible > 0 ? Math.round((exam.pass_mark / 100) * totalPossible) : 0
  const passCount    = rows.filter(r => r.passed === true).length
  const failCount    = rows.filter(r => r.passed === false).length
  const passRate     = rows.length > 0 ? Math.round((passCount / rows.length) * 100) : null
  const avgScore     = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
  const maxScore     = scores.length > 0 ? Math.max(...scores) : null
  const minScore     = scores.length > 0 ? Math.min(...scores) : null
  const medianScore  = scores.length > 0
    ? [...scores].sort((a, b) => a - b)[Math.floor(scores.length / 2)]
    : null

  // Score distribution: 10 buckets 0-9%, 10-19%, ... 90-100%
  const buckets = Array(10).fill(0)
  for (const s of scores) {
    const pct   = totalPossible > 0 ? (s / totalPossible) * 100 : 0
    const bucket = Math.min(9, Math.floor(pct / 10))
    buckets[bucket]++
  }
  const maxBucket = Math.max(...buckets, 1)

  // Per-question difficulty: % who got it wrong
  const qMap = {}
  for (const r of allResponses ?? []) {
    if (!qMap[r.question_id]) qMap[r.question_id] = { total: 0, wrong: 0 }
    qMap[r.question_id].total++
    if (r.is_correct === false) qMap[r.question_id].wrong++
  }
  const hardQuestions = Object.entries(qMap)
    .map(([qid, s]) => ({ qid, wrongRate: s.total > 0 ? Math.round((s.wrong / s.total) * 100) : 0, total: s.total }))
    .filter(q => q.wrongRate >= 50)
    .sort((a, b) => b.wrongRate - a.wrongRate)
    .slice(0, 5)

  const atRiskRows = rows.filter(r => r.passed === false).slice(0, 8)

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <Link href={`/lecturer/exams/${id}`} className="text-sm text-text-muted hover:text-primary transition-colors">
        ← Back to Exam
      </Link>

      <div className="flex items-start justify-between gap-4 mt-2 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">Results</h1>
            <Badge variant={exam.status} />
          </div>
          <p className="text-sm text-text-secondary">
            <span className="font-mono">{exam.courses?.course_code}</span>
            {' · '}{exam.title}
            {' · '}Pass mark: {exam.pass_mark}% ({passMarkAbs}/{totalPossible})
          </p>
        </div>
      </div>

      {dataError ? (
        <QueryErrorBanner message="Failed to load result data for this exam. Please refresh." />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No submissions yet"
          description={exam.status === 'live' || exam.status === 'scheduled'
            ? "Students haven't submitted this exam yet."
            : 'No students completed this exam.'}
        />
      ) : (
        <div className="space-y-6">
          {/* Key stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatBox label="Submissions" value={rows.length} />
            <StatBox
              label="Pass Rate"
              value={passRate !== null ? `${passRate}%` : '—'}
              color={passRate !== null ? (passRate >= 60 ? 'success' : 'danger') : undefined}
            />
            <StatBox label="Average"  value={avgScore !== null ? `${avgScore}/${totalPossible}` : '—'} />
            <StatBox label="Highest"  value={maxScore !== null ? `${maxScore}/${totalPossible}` : '—'} color="success" />
            <StatBox label="Lowest"   value={minScore !== null ? `${minScore}/${totalPossible}` : '—'} color="danger" />
            <StatBox label="Median"   value={medianScore !== null ? `${medianScore}/${totalPossible}` : '—'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: score distribution + full table */}
            <div className="lg:col-span-2 space-y-5">
              {/* Score distribution histogram */}
              <div className="bg-surface border border-border rounded-xl p-5">
                <h2 className="text-sm font-semibold text-text-primary mb-4">Score Distribution</h2>
                <div className="flex items-end gap-1.5 h-28">
                  {buckets.map((count, i) => {
                    const pctHeight = Math.round((count / maxBucket) * 100)
                    const label     = `${i * 10}–${i * 10 + 9}%`
                    const isPass    = (i * 10 + 9) >= exam.pass_mark
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-xs text-text-muted tabular-nums">{count > 0 ? count : ''}</span>
                        <div className="w-full flex items-end" style={{ height: '80px' }}>
                          <div
                            className={`w-full rounded-t bar-chart-bar ${isPass ? 'bg-success/70' : 'bg-danger/60'}`}
                            style={{ height: `${pctHeight}%`, minHeight: count > 0 ? '4px' : '0' }}
                            title={`${label}: ${count} student${count !== 1 ? 's' : ''}`}
                          />
                        </div>
                        <span className="text-[10px] text-text-muted rotate-0 leading-tight text-center">
                          {i * 10}%
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-center gap-4 mt-3 text-xs text-text-muted">
                  <span className="flex items-center gap-1.5"><span className="size-2.5 rounded bg-success/70 inline-block" />Pass range (≥{exam.pass_mark}%)</span>
                  <span className="flex items-center gap-1.5"><span className="size-2.5 rounded bg-danger/60 inline-block" />Fail range</span>
                </div>
              </div>

              {/* Full results table */}
              <ResultsTable
                rows={rows}
                totalPossible={totalPossible}
                examTitle={exam.title}
              />
            </div>

            {/* Right: at-risk + hard questions */}
            <div className="space-y-5">
              {/* Pass / fail split */}
              <div className="bg-surface border border-border rounded-xl p-5">
                <h2 className="text-sm font-semibold text-text-primary mb-3">Class Split</h2>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-success font-medium">Passed</span>
                      <span className="font-semibold text-success">{passCount}</span>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-success rounded-full bar-chart-bar" style={{ width: `${passRate ?? 0}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-danger font-medium">Failed</span>
                      <span className="font-semibold text-danger">{failCount}</span>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-danger rounded-full bar-chart-bar" style={{ width: `${100 - (passRate ?? 0)}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Students who failed — at risk */}
              {atRiskRows.length > 0 && (
                <div className="bg-danger-light border border-danger/20 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={14} className="text-danger" />
                    <h2 className="text-sm font-semibold text-danger">Failed Students</h2>
                  </div>
                  <div className="space-y-2.5">
                    {atRiskRows.map(r => (
                      <div key={r.attempt_id} className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-text-primary truncate">{r.full_name}</p>
                          {r.matric_number && (
                            <p className="text-xs font-mono text-text-muted">{r.matric_number}</p>
                          )}
                        </div>
                        <div className="shrink-0 ml-2 text-right">
                          <span className="text-xs font-bold text-danger tabular-nums">
                            {r.score}/{totalPossible}
                          </span>
                          <p className="text-xs text-text-muted">{r.percentage}%</p>
                        </div>
                      </div>
                    ))}
                    {rows.filter(r => r.passed === false).length > 8 && (
                      <p className="text-xs text-text-muted">
                        +{rows.filter(r => r.passed === false).length - 8} more in the table below
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Hardest questions */}
              {hardQuestions.length > 0 && (
                <div className="bg-surface border border-border rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Award size={14} className="text-warning" />
                    <h2 className="text-sm font-semibold text-text-primary">Hardest Questions</h2>
                  </div>
                  <p className="text-xs text-text-muted mb-3">Questions where ≥50% of students answered incorrectly.</p>
                  <div className="space-y-3">
                    {hardQuestions.map((q, i) => (
                      <div key={q.qid}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-text-secondary">Question {i + 1}</span>
                          <span className="font-semibold text-danger">{q.wrongRate}% wrong</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-danger/60 rounded-full bar-chart-bar"
                            style={{ width: `${q.wrongRate}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-text-muted mt-3">
                    Consider revisiting these topics in class.
  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value, color }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 text-center">
      <p className={`text-lg font-bold tabular-nums ${
        color === 'success' ? 'text-success' :
        color === 'danger'  ? 'text-danger'  :
        'text-text-primary'
      }`}>{value}</p>
      <p className="text-xs text-text-muted mt-0.5">{label}</p>
    </div>
  )
}
