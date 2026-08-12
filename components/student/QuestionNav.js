'use client'

import { Bookmark, RefreshCw } from 'lucide-react'

export function QuestionNav({ questions, answers, flagged, currentIndex, saveStatus = {}, onNavigate }) {
  const answeredCount = questions.filter(q => {
    const a = answers[q.question_id]
    if (a === null || a === undefined || a === '') return false
    if (Array.isArray(a)) return a.length > 0
    return true
  }).length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Questions</span>
        <span className="text-xs text-text-muted">{answeredCount}/{questions.length} answered</span>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {questions.map((q, index) => {
          const isAnswered = (() => {
            const a = answers[q.question_id]
            if (a === null || a === undefined || a === '') return false
            if (Array.isArray(a)) return a.length > 0
            return true
          })()
          const isFlagged  = flagged.has(q.question_id)
          const isCurrent  = index === currentIndex
          const isUnsynced = saveStatus[q.question_id] === 'error'

          let btnClass = 'relative w-full aspect-square rounded-lg text-xs font-medium transition-all flex items-center justify-center '

          if (isCurrent) {
            btnClass += 'ring-2 ring-primary ring-offset-1 '
          }

          if (isFlagged) {
            btnClass += 'bg-warning-light text-warning border border-warning/30'
          } else if (isAnswered) {
            btnClass += 'bg-primary text-white'
          } else {
            btnClass += 'border border-border text-text-muted hover:border-primary/40 hover:text-primary'
          }

          return (
            <button
              key={q.question_id}
              onClick={() => onNavigate(index)}
              aria-label={`Question ${index + 1}${isAnswered ? ', answered' : ''}${isFlagged ? ', flagged' : ''}${isUnsynced ? ', not yet synced' : ''}`}
              className={btnClass}
            >
              {index + 1}
              {isFlagged && (
                <Bookmark size={8} className="absolute top-0.5 right-0.5 fill-current" />
              )}
              {isUnsynced && (
                <RefreshCw size={8} className="absolute top-0.5 left-0.5 text-amber-600" />
              )}
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 pt-1">
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="w-3 h-3 rounded border border-border inline-block" />
          Unanswered
        </span>
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="w-3 h-3 rounded bg-primary inline-block" />
          Answered
        </span>
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="w-3 h-3 rounded bg-warning-light border border-warning/30 inline-block" />
          Flagged
        </span>
      </div>
    </div>
  )
}
