'use client'

import {
  CheckSquare,
  ToggleLeft,
  List,
  PenLine,
  MessageSquare,
  FileText,
} from 'lucide-react'

const TYPES = [
  {
    value: 'mcq',
    label: 'Multiple Choice',
    description: 'Single correct answer',
    icon: List,
  },
  {
    value: 'multi_select',
    label: 'Multi-select',
    description: 'Multiple correct answers',
    icon: CheckSquare,
  },
  {
    value: 'true_false',
    label: 'True / False',
    description: 'Binary choice',
    icon: ToggleLeft,
  },
  {
    value: 'fill_blank',
    label: 'Fill-in-blank',
    description: 'Complete the sentence',
    icon: PenLine,
  },
  {
    value: 'short_answer',
    label: 'Short Answer',
    description: 'Brief written response',
    icon: MessageSquare,
  },
  {
    value: 'essay',
    label: 'Essay',
    description: 'Extended response',
    icon: FileText,
  },
]

export function TypeSelector({ value, onChange, error }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium text-text-primary">
        Question type <span className="text-danger" aria-hidden="true">*</span>
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {TYPES.map(({ value: v, label, description, icon: Icon }) => {
          const selected = value === v
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={[
                'flex items-center gap-3 p-3 rounded-xl border text-left transition-all',
                selected
                  ? 'border-primary bg-primary-light ring-1 ring-primary/30'
                  : 'border-border bg-surface hover:border-border-focus hover:bg-page',
              ].join(' ')}
            >
              <span className={[
                'flex size-8 shrink-0 items-center justify-center rounded-lg',
                selected ? 'bg-primary' : 'bg-page',
              ].join(' ')}>
                <Icon className={`size-4 ${selected ? 'text-white' : 'text-text-secondary'}`} />
              </span>
              <div className="min-w-0">
                <p className={`text-xs font-semibold leading-tight truncate ${selected ? 'text-primary' : 'text-text-primary'}`}>
                  {label}
                </p>
                <p className="text-xs text-text-muted leading-tight mt-0.5 truncate">
                  {description}
                </p>
              </div>
            </button>
          )
        })}
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">{error}</p>
      )}
    </div>
  )
}
