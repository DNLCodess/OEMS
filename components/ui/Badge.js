/**
 * Badge — inline label for categorical data (type, difficulty, status).
 * Color communicates meaning, but is always accompanied by text (accessibility).
 */
const variants = {
  // Question types
  mcq:          'bg-primary-light text-primary',
  multi_select: 'bg-purple-100 text-purple-700',
  true_false:   'bg-success-light text-success',
  fill_blank:   'bg-warning-light text-warning',
  short_answer: 'bg-slate-100 text-slate-600',
  essay:        'bg-slate-100 text-slate-600',

  // Difficulty — matches the cognitive weight of each level
  easy:   'bg-success-light text-success',
  medium: 'bg-warning-light text-warning',
  hard:   'bg-danger-light text-danger',

  // Exam status
  draft:     'bg-slate-100 text-slate-600',
  scheduled: 'bg-primary-light text-primary',
  live:      'bg-success-light text-success',
  closed:    'bg-slate-100 text-slate-500',

  // Generic
  default: 'bg-slate-100 text-slate-600',
}

const LABELS = {
  mcq:          'MCQ',
  multi_select: 'Multi-select',
  true_false:   'True / False',
  fill_blank:   'Fill-in-blank',
  short_answer: 'Short answer',
  essay:        'Essay',
  easy:         'Easy',
  medium:       'Medium',
  hard:         'Hard',
  draft:        'Draft',
  scheduled:    'Scheduled',
  live:         'Live',
  closed:       'Closed',
}

export function Badge({ variant = 'default', label, className = '' }) {
  const style = variants[variant] ?? variants.default
  const text = label ?? LABELS[variant] ?? variant

  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${style} ${className}`}>
      {text}
    </span>
  )
}
