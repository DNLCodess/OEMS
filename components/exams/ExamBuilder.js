'use client'

import { useState, useCallback } from 'react'
import { Plus, Trash2, ChevronUp, ChevronDown, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/Badge'
import { QuestionPickerModal } from '@/components/exams/QuestionPickerModal'
import {
  removeQuestionFromExam,
  updateQuestionMarks,
  reorderExamQuestions,
} from '@/lib/actions/exams'

function stripHtml(html) {
  return html?.replace(/<[^>]*>/g, '').trim() ?? ''
}

function totalMarks(questions) {
  return questions.reduce((sum, q) => sum + (q.marks ?? 0), 0)
}

export function ExamBuilder({ examId, initialQuestions, bankQuestions, readOnly = false }) {
  const [questions, setQuestions] = useState(
    [...initialQuestions].sort((a, b) => a.order_index - b.order_index)
  )
  const [showPicker, setShowPicker]   = useState(false)
  const [removing, setRemoving]       = useState(null)
  const [reordering, setReordering]   = useState(false)

  const addedIds = new Set(questions.map(q => q.question_id))

  // Called by QuestionPickerModal after a successful server action
  const handleQuestionAdded = useCallback((examQuestion) => {
    setQuestions(prev => [...prev, examQuestion])
  }, [])

  async function handleRemove(questionId) {
    if (removing) return
    setRemoving(questionId)
    const result = await removeQuestionFromExam(examId, questionId)
    setRemoving(null)

    if (result?.error) {
      toast.error(result.error)
      return
    }
    setQuestions(prev => prev.filter(q => q.question_id !== questionId))
    toast.success('Question removed.')
  }

  async function handleMarksBlur(questionId, value) {
    const marks = parseInt(value, 10)
    if (!marks || marks < 1) {
      toast.error('Marks must be at least 1.')
      return
    }
    const result = await updateQuestionMarks(examId, questionId, marks)
    if (result?.error) {
      toast.error(result.error)
    }
    setQuestions(prev =>
      prev.map(q => q.question_id === questionId ? { ...q, marks } : q)
    )
  }

  async function handleMove(index, direction) {
    const newOrder = [...questions]
    const target   = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= newOrder.length) return

    ;[newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]]
    setQuestions(newOrder)
    setReordering(true)

    const ids = newOrder.map(q => q.question_id)
    const result = await reorderExamQuestions(examId, ids)
    setReordering(false)

    if (result?.error) {
      toast.error(result.error)
      // revert
      setQuestions(questions)
    }
  }

  const total = totalMarks(questions)

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-text-primary">
            {questions.length} {questions.length === 1 ? 'question' : 'questions'}
          </span>
          {questions.length > 0 && (
            <span className="text-sm text-text-muted ml-2">· {total} total marks</span>
          )}
        </div>
        {!readOnly && (
          <button
            onClick={() => setShowPicker(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors"
          >
            <Plus size={16} />
            Add Question
          </button>
        )}
      </div>

      {/* Question list */}
      {questions.length === 0 ? (
        <div className="border-2 border-dashed border-border rounded-xl py-16 text-center">
          <p className="text-sm text-text-muted mb-3">No questions added yet.</p>
          {!readOnly && (
            <button
              onClick={() => setShowPicker(true)}
              className="text-sm text-primary font-medium hover:underline"
            >
              Add your first question
            </button>
          )}
        </div>
      ) : (
        <div className={`space-y-2 ${reordering ? 'opacity-70 pointer-events-none' : ''}`}>
          {questions.map((q, index) => {
            const qb = q.question_bank
            return (
              <div
                key={q.id ?? q.question_id}
                className="bg-surface border border-border rounded-xl px-4 py-3 flex items-start gap-3"
              >
                {/* Drag handle placeholder + order number */}
                <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
                  {!readOnly && (
                    <GripVertical size={14} className="text-text-muted" />
                  )}
                  <span className="text-xs font-mono text-text-muted w-5 text-center">
                    {index + 1}
                  </span>
                </div>

                {/* Question body */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary line-clamp-2 mb-1.5">
                    {stripHtml(qb?.body ?? '')}
                  </p>
                  <div className="flex items-center gap-2">
                    {qb?.type && <Badge variant={qb.type} />}
                    {qb?.difficulty && <Badge variant={qb.difficulty} />}
                    {qb?.courses?.course_code && (
                      <span className="font-mono text-xs text-text-muted">{qb.courses.course_code}</span>
                    )}
                  </div>
                </div>

                {/* Marks input */}
                {!readOnly && (
                  <div className="shrink-0 flex items-center gap-1.5">
                    <label className="text-xs text-text-muted sr-only" htmlFor={`marks-${q.question_id}`}>
                      Marks
                    </label>
                    <input
                      id={`marks-${q.question_id}`}
                      type="number"
                      min={1}
                      defaultValue={q.marks}
                      onBlur={e => handleMarksBlur(q.question_id, e.target.value)}
                      className="w-14 text-center text-sm border border-border rounded-lg px-2 py-1.5 bg-surface focus:outline-none focus:border-border-focus focus:ring-2 focus:ring-primary/15"
                      title="Marks for this question"
                    />
                    <span className="text-xs text-text-muted">mk</span>
                  </div>
                )}

                {/* Reorder + remove controls */}
                {!readOnly && (
                  <div className="shrink-0 flex items-center gap-0.5">
                    <button
                      onClick={() => handleMove(index, 'up')}
                      disabled={index === 0}
                      aria-label="Move up"
                      className="p-1.5 rounded hover:bg-slate-100 text-text-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronUp size={15} />
                    </button>
                    <button
                      onClick={() => handleMove(index, 'down')}
                      disabled={index === questions.length - 1}
                      aria-label="Move down"
                      className="p-1.5 rounded hover:bg-slate-100 text-text-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronDown size={15} />
                    </button>
                    <button
                      onClick={() => handleRemove(q.question_id)}
                      disabled={removing === q.question_id}
                      aria-label="Remove question"
                      className="p-1.5 rounded hover:bg-danger-light text-text-muted hover:text-danger disabled:opacity-50 transition-colors ml-1"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}

                {/* Read-only marks display */}
                {readOnly && (
                  <span className="shrink-0 text-sm font-medium text-text-secondary">
                    {q.marks} mk
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Picker modal */}
      {showPicker && (
        <QuestionPickerModal
          examId={examId}
          questions={bankQuestions}
          addedIds={addedIds}
          onAdd={handleQuestionAdded}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
