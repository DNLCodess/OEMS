'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, XCircle, HelpCircle, Save, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { updateResponseGrade, recalculateResult } from '@/lib/actions/results'

function stripHtml(html) {
  return html?.replace(/<[^>]*>/g, '').trim() ?? ''
}

function AutoGradeChip({ isCorrect }) {
  if (isCorrect === true)  return <span className="flex items-center gap-1 text-xs text-success font-medium"><CheckCircle2 size={13} />Correct</span>
  if (isCorrect === false) return <span className="flex items-center gap-1 text-xs text-danger  font-medium"><XCircle     size={13} />Incorrect</span>
  return <span className="flex items-center gap-1 text-xs text-text-muted"><HelpCircle size={13} />Manual grading</span>
}

function formatAnswer(answer, options) {
  if (answer === null || answer === undefined) return <span className="italic text-text-muted">No answer</span>
  if (Array.isArray(answer)) {
    const texts = answer.map(id => options?.find(o => o.id === id)?.text ?? id)
    return texts.join(', ')
  }
  if (options?.length) {
    const opt = options.find(o => o.id === answer)
    return opt?.text ?? String(answer)
  }
  return String(answer)
}

export function GradePanel({ examId, attemptId, questions }) {
  const router = useRouter()

  // Local state only for manual questions
  const manualQuestions = questions.filter(q => q.is_correct === null)

  const [grades, setGrades] = useState(() => {
    const init = {}
    for (const q of manualQuestions) {
      init[q.response_id] = {
        marks:    q.marks_awarded ?? 0,
        feedback: q.teacher_feedback ?? '',
      }
    }
    return init
  })

  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)

  function updateField(responseId, field, value) {
    setSaved(false)
    setGrades(prev => ({ ...prev, [responseId]: { ...prev[responseId], [field]: value } }))
  }

  async function handleSave() {
    setSaving(true)

    // Validate marks don't exceed max
    for (const q of manualQuestions) {
      const g = grades[q.response_id]
      const marks = parseInt(g.marks, 10)
      if (isNaN(marks) || marks < 0 || marks > q.question_marks) {
        toast.error(`Marks for Q${q.order_num} must be between 0 and ${q.question_marks}.`)
        setSaving(false)
        return
      }
    }

    // Save each manual response grade
    const updates = manualQuestions.map(q =>
      updateResponseGrade(examId, q.response_id, grades[q.response_id].marks, grades[q.response_id].feedback)
    )
    const results = await Promise.all(updates)
    const failed  = results.find(r => r?.error)
    if (failed) {
      toast.error(failed.error)
      setSaving(false)
      return
    }

    // Recalculate total score
    const recalc = await recalculateResult(examId, attemptId)
    setSaving(false)
    if (recalc?.error) {
      toast.error(recalc.error)
      return
    }

    setSaved(true)
    toast.success('Grades saved and score recalculated.')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {questions.map((q, index) => {
        const isManual = q.is_correct === null
        const grade    = grades[q.response_id]

        return (
          <div
            key={q.question_id}
            className={[
              'bg-surface border rounded-xl p-5',
              isManual ? 'border-warning/30' : q.is_correct ? 'border-success/20' : 'border-border',
            ].join(' ')}
          >
            {/* Question header */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-text-muted bg-slate-100 px-2 py-0.5 rounded">
                  Q{q.order_num}
                </span>
                <Badge variant={q.type} />
                <span className="text-xs text-text-muted">{q.question_marks} mark{q.question_marks !== 1 ? 's' : ''}</span>
              </div>
              <AutoGradeChip isCorrect={q.is_correct} />
            </div>

            {/* Question body */}
            <p className="text-sm text-text-primary mb-3 leading-relaxed">
              {stripHtml(q.body)}
            </p>

            {/* Student's answer */}
            <div className="bg-slate-50 rounded-lg p-3 mb-3">
              <p className="text-xs font-medium text-text-muted mb-1">Student's answer</p>
              <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                {formatAnswer(q.student_answer, q.options)}
              </p>
            </div>

            {/* Auto-graded: marks awarded (readonly) */}
            {!isManual && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-text-muted">Marks awarded:</span>
                <span className={`font-semibold ${q.is_correct ? 'text-success' : 'text-danger'}`}>
                  {q.marks_awarded} / {q.question_marks}
                </span>
              </div>
            )}

            {/* Manual grading inputs */}
            {isManual && grade && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-3">
                  <label className="text-sm text-text-muted shrink-0">
                    Marks awarded (max {q.question_marks}):
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={q.question_marks}
                    value={grade.marks}
                    onChange={e => updateField(q.response_id, 'marks', e.target.value)}
                    className="w-20 text-center text-sm border border-border rounded-lg px-2 py-1.5 bg-surface focus:outline-none focus:border-border-focus focus:ring-2 focus:ring-primary/15"
                  />
                  <span className="text-xs text-text-muted">/ {q.question_marks}</span>
                </div>

                <div>
                  <label className="text-sm text-text-muted block mb-1">
                    Feedback <span className="text-text-muted">(optional — visible to student)</span>
                  </label>
                  <textarea
                    value={grade.feedback}
                    onChange={e => updateField(q.response_id, 'feedback', e.target.value)}
                    rows={2}
                    placeholder="e.g. Good attempt, but missing the key definition of…"
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-surface resize-none focus:outline-none focus:border-border-focus focus:ring-2 focus:ring-primary/15"
                  />
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Save button — only shown if there are manual questions */}
      {manualQuestions.length > 0 && (
        <div className="flex items-center justify-end gap-3 pt-2">
          {saved && (
            <span className="text-xs text-success flex items-center gap-1">
              <CheckCircle2 size={13} />
              Grades saved
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-hover disabled:opacity-60 transition-colors"
          >
            {saving ? (
              <><Loader2 size={15} className="animate-spin" />Saving…</>
            ) : (
              <><Save size={15} />Save Grades</>
            )}
          </button>
        </div>
      )}

      {manualQuestions.length === 0 && (
        <div className="text-center py-4 text-sm text-text-muted">
          All questions are auto-graded. No manual input required.
        </div>
      )}
    </div>
  )
}
