'use client'

import { useState, useMemo } from 'react'
import { X, Search, Plus, Check } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { toast } from 'sonner'
import { addQuestionToExam } from '@/lib/actions/exams'

function stripHtml(html) {
  return html?.replace(/<[^>]*>/g, '').trim() ?? ''
}

const TYPE_LABELS = {
  mcq:          'MCQ',
  multi_select: 'Multi-select',
  true_false:   'True / False',
  fill_blank:   'Fill-in-blank',
}

export function QuestionPickerModal({ examId, questions, addedIds, onAdd, onClose }) {
  const [search, setSearch]         = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [adding, setAdding]         = useState(null) // questionId being added

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return questions.filter(question => {
      if (typeFilter && question.type !== typeFilter) return false
      if (q && !stripHtml(question.body).toLowerCase().includes(q)) return false
      return true
    })
  }, [questions, search, typeFilter])

  async function handleAdd(question) {
    if (addedIds.has(question.id) || adding) return
    setAdding(question.id)
    const result = await addQuestionToExam(examId, question.id)
    setAdding(null)

    if (result?.error) {
      toast.error(result.error)
      return
    }
    onAdd(result.examQuestion)
    toast.success('Question added.')
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary">Add Questions</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-text-muted hover:text-text-primary transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-border">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              placeholder="Search questions…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:border-border-focus focus:ring-2 focus:ring-primary/15"
            />
          </div>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-2 bg-surface focus:outline-none focus:border-border-focus"
          >
            <option value="">All types</option>
            {Object.entries(TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>

        {/* Question list */}
        <div className="overflow-y-auto flex-1 divide-y divide-border">
          {filtered.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-12">No questions match your filter.</p>
          ) : (
            filtered.map(question => {
              const isAdded   = addedIds.has(question.id)
              const isAdding  = adding === question.id

              return (
                <div key={question.id} className="flex items-start gap-4 px-6 py-4 hover:bg-slate-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary line-clamp-2 mb-1.5">
                      {stripHtml(question.body)}
                    </p>
                    <div className="flex items-center gap-2">
                      <Badge variant={question.type} />
                      <Badge variant={question.difficulty} />
                      {question.courses?.course_code && (
                        <span className="font-mono text-xs text-text-muted">
                          {question.courses.course_code}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => handleAdd(question)}
                    disabled={isAdded || isAdding}
                    aria-label={isAdded ? 'Already added' : 'Add question'}
                    className={[
                      'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      isAdded
                        ? 'bg-success-light text-success cursor-default'
                        : 'bg-primary text-white hover:bg-primary-hover disabled:opacity-50',
                    ].join(' ')}
                  >
                    {isAdded ? (
                      <><Check size={12} /> Added</>
                    ) : isAdding ? (
                      'Adding…'
                    ) : (
                      <><Plus size={12} /> Add</>
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border text-xs text-text-muted">
          {filtered.length} question{filtered.length !== 1 ? 's' : ''} · {addedIds.size} added to exam
        </div>
      </div>
    </div>
  )
}
