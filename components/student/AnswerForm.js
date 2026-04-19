'use client'

import { MathContent } from '@/components/ui/MathContent'

// Renders the correct input for each question type.
// IMPORTANT: correct_answer is never passed to this component — it lives server-side only.

function OptionCard({ id, label, selected, onChange, type = 'radio', name }) {
  return (
    <label
      className={[
        'flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all',
        selected
          ? 'border-primary bg-primary-light'
          : 'border-border bg-surface hover:border-primary/40',
      ].join(' ')}
    >
      <input
        type={type}
        name={name}
        value={id}
        checked={selected}
        onChange={() => onChange(id)}
        className="mt-0.5 accent-primary shrink-0"
      />
      <MathContent html={label} className="text-sm text-text-primary leading-relaxed" />
    </label>
  )
}

export function AnswerForm({ question, answer, onChange }) {
  const { question_id, type, options } = question

  // ── MCQ ─────────────────────────────────────────────────────────────────────
  if (type === 'mcq') {
    return (
      <div className="space-y-2.5" role="radiogroup">
        {(options ?? []).map(opt => (
          <OptionCard
            key={opt.id}
            id={opt.id}
            label={opt.text}
            name={`q-${question_id}`}
            selected={answer === opt.id}
            onChange={id => onChange(id)}
          />
        ))}
      </div>
    )
  }

  // ── Multi-select ─────────────────────────────────────────────────────────────
  if (type === 'multi_select') {
    const selected = Array.isArray(answer) ? answer : []
    return (
      <div className="space-y-2.5">
        <p className="text-xs text-text-muted mb-3">Select all that apply.</p>
        {(options ?? []).map(opt => {
          const isSelected = selected.includes(opt.id)
          return (
            <OptionCard
              key={opt.id}
              id={opt.id}
              label={opt.text}
              type="checkbox"
              name={`q-${question_id}`}
              selected={isSelected}
              onChange={id => {
                const next = isSelected
                  ? selected.filter(x => x !== id)
                  : [...selected, id]
                onChange(next)
              }}
            />
          )
        })}
      </div>
    )
  }

  // ── True / False ─────────────────────────────────────────────────────────────
  if (type === 'true_false') {
    return (
      <div className="flex gap-3" role="radiogroup">
        {[
          { id: 'true',  label: 'True'  },
          { id: 'false', label: 'False' },
        ].map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={[
              'flex-1 py-4 rounded-xl border text-sm font-semibold transition-all',
              answer === opt.id
                ? 'border-primary bg-primary text-white'
                : 'border-border bg-surface text-text-primary hover:border-primary/40',
            ].join(' ')}
            aria-pressed={answer === opt.id}
          >
            {opt.label}
          </button>
        ))}
      </div>
    )
  }

  // ── Fill in the blank ────────────────────────────────────────────────────────
  if (type === 'fill_blank') {
    return (
      <div>
        <label className="text-sm text-text-muted block mb-2">Your answer</label>
        <input
          type="text"
          value={answer ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder="Type your answer here…"
          className="w-full max-w-sm rounded-xl border border-border px-4 py-3 text-sm text-text-primary bg-surface focus:outline-none focus:border-border-focus focus:ring-2 focus:ring-primary/15"
        />
      </div>
    )
  }

  // ── Short answer ─────────────────────────────────────────────────────────────
  if (type === 'short_answer') {
    return (
      <div>
        <label className="text-sm text-text-muted block mb-2">
          Your answer <span className="text-text-muted">(a few sentences)</span>
        </label>
        <textarea
          value={answer ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder="Type your answer here…"
          rows={4}
          className="w-full rounded-xl border border-border px-4 py-3 text-sm text-text-primary bg-surface resize-y focus:outline-none focus:border-border-focus focus:ring-2 focus:ring-primary/15"
        />
        <p className="text-xs text-text-muted mt-1.5">This question will be manually graded by your lecturer.</p>
      </div>
    )
  }

  // ── Essay ────────────────────────────────────────────────────────────────────
  if (type === 'essay') {
    return (
      <div>
        <label className="text-sm text-text-muted block mb-2">Your response</label>
        <textarea
          value={answer ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder="Write your essay response here…"
          rows={10}
          className="w-full rounded-xl border border-border px-4 py-3 text-sm text-text-primary bg-surface resize-y focus:outline-none focus:border-border-focus focus:ring-2 focus:ring-primary/15 leading-relaxed"
        />
        <p className="text-xs text-text-muted mt-1.5">This question will be manually graded by your lecturer.</p>
      </div>
    )
  }

  return null
}
