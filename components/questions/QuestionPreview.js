'use client'

import { X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'

const TYPE_LABELS = {
  mcq:          'Multiple Choice — select one',
  multi_select: 'Multiple Choice — select all that apply',
  true_false:   'True or False',
  fill_blank:   'Fill in the blank',
}

export function QuestionPreview({ open, onClose, question }) {
  if (!open) return null

  const { type, body, options, correct_answer: correctAnswer } = question

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <p className="text-xs text-text-muted mb-0.5">Student preview</p>
            <div className="flex items-center gap-2">
              <Badge variant={type} />
              {question.difficulty && <Badge variant={question.difficulty} />}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-text-muted hover:bg-page hover:text-text-primary transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* Question instruction */}
          <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
            {TYPE_LABELS[type] ?? type}
          </p>

          {/* Question body — lecturer-authored HTML, safe source */}
          <div
            className="text-base text-text-primary leading-relaxed"
            dangerouslySetInnerHTML={{ __html: body || '<em>No question body</em>' }}
          />

          {/* Answer area */}
          {(type === 'mcq' || type === 'multi_select') && Array.isArray(options) && options.length > 0 && (
            <div className="space-y-2.5">
              {options.map((opt, i) => (
                <div key={opt.id ?? i} className="flex items-center gap-3 border border-border rounded-lg px-4 py-3">
                  <span className={[
                    'shrink-0 flex items-center justify-center border-2 text-xs font-bold',
                    type === 'multi_select'
                      ? 'size-4 rounded border-border-focus'
                      : 'size-4 rounded-full border-border-focus',
                  ].join(' ')} />
                  <span className="text-sm text-text-primary">{opt.text || <em className="text-text-muted">Empty option</em>}</span>
                </div>
              ))}
            </div>
          )}

          {type === 'true_false' && (
            <div className="flex gap-3">
              {['True', 'False'].map(opt => (
                <div key={opt} className="flex items-center gap-2.5 border border-border rounded-lg px-4 py-3 flex-1">
                  <span className="size-4 rounded-full border-2 border-border-focus shrink-0" />
                  <span className="text-sm text-text-primary">{opt}</span>
                </div>
              ))}
            </div>
          )}

          {type === 'fill_blank' && (
            <div className="border border-border rounded-lg px-4 py-3 bg-page">
              <p className="text-sm text-text-muted">Student types their answer here…</p>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-border bg-page rounded-b-2xl shrink-0">
          <p className="text-xs text-text-muted text-center">
            This is how students will see this question during an exam.
          </p>
        </div>
      </div>
    </div>
  )
}
