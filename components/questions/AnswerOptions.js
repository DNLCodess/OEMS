'use client'

import { useFieldArray } from 'react-hook-form'
import { Plus, Trash2 } from 'lucide-react'

const MAX_OPTIONS = { mcq: 6, multi_select: 8, true_false: 2 }

/**
 * MCQ / Multi-select option builder.
 * The input type (radio vs checkbox) mirrors what the student will see,
 * so the lecturer immediately understands the selection model.
 */
export function AnswerOptions({ control, register, watch, setValue, type, errors }) {
  const { fields, append, remove } = useFieldArray({ control, name: 'options' })
  const correctAnswer = watch('correct_answer')
  const max = MAX_OPTIONS[type] ?? 6
  const isMulti = type === 'multi_select'

  function handleCorrectToggle(optionId) {
    if (isMulti) {
      const current = Array.isArray(correctAnswer) ? correctAnswer : []
      const next = current.includes(optionId)
        ? current.filter(id => id !== optionId)
        : [...current, optionId]
      setValue('correct_answer', next, { shouldValidate: true })
    } else {
      setValue('correct_answer', optionId, { shouldValidate: true })
    }
  }

  function isSelected(optionId) {
    if (isMulti) {
      return Array.isArray(correctAnswer) && correctAnswer.includes(optionId)
    }
    return correctAnswer === optionId
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-text-primary">
          Answer options <span className="text-danger" aria-hidden="true">*</span>
        </p>
        <p className="text-xs text-text-muted">
          {isMulti ? 'Check all correct answers' : 'Select the correct answer'}
        </p>
      </div>

      <div className="space-y-2">
        {fields.map((field, index) => {
          const selected = isSelected(field.id)
          return (
            <div
              key={field.id}
              className={[
                'flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                selected ? 'border-primary bg-primary-light' : 'border-border bg-surface',
              ].join(' ')}
            >
              {/* Correct answer toggle — visually matches what students will see */}
              <button
                type="button"
                onClick={() => handleCorrectToggle(field.id)}
                aria-label={isMulti ? 'Toggle correct' : 'Mark as correct'}
                className="shrink-0"
              >
                {isMulti ? (
                  <span className={[
                    'flex size-4 rounded border-2 items-center justify-center',
                    selected ? 'bg-primary border-primary' : 'border-border-focus',
                  ].join(' ')}>
                    {selected && (
                      <svg viewBox="0 0 10 8" className="size-2.5 fill-white">
                        <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                      </svg>
                    )}
                  </span>
                ) : (
                  <span className={[
                    'flex size-4 rounded-full border-2 items-center justify-center',
                    selected ? 'border-primary' : 'border-border-focus',
                  ].join(' ')}>
                    {selected && <span className="size-2 rounded-full bg-primary" />}
                  </span>
                )}
              </button>

              <input
                {...register(`options.${index}.text`)}
                type="text"
                placeholder={`Option ${index + 1}`}
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-text-muted text-text-primary"
              />

              {fields.length > 2 && (
                <button
                  type="button"
                  onClick={() => {
                    remove(index)
                    // Clear this option from correct_answer if it was selected
                    if (isMulti && Array.isArray(correctAnswer)) {
                      setValue('correct_answer', correctAnswer.filter(id => id !== field.id))
                    } else if (correctAnswer === field.id) {
                      setValue('correct_answer', null)
                    }
                  }}
                  className="shrink-0 text-text-muted hover:text-danger transition-colors"
                  aria-label="Remove option"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {errors?.options && (
        <p role="alert" className="text-xs text-danger">{errors.options.message || 'All options need text'}</p>
      )}
      {errors?.correct_answer && (
        <p role="alert" className="text-xs text-danger">{errors.correct_answer.message}</p>
      )}

      {fields.length < max && (
        <button
          type="button"
          onClick={() => append({ id: crypto.randomUUID(), text: '' })}
          className="flex items-center gap-2 text-sm text-primary hover:text-primary-hover font-medium w-fit"
        >
          <Plus className="size-4" />
          Add option
        </button>
      )}
    </div>
  )
}

/**
 * Fixed True/False selector — two options, one radio to pick the correct one.
 * Not using AnswerOptions because the options are immutable here.
 */
export function TrueFalseSelector({ value, onChange, error }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium text-text-primary">
        Correct answer <span className="text-danger" aria-hidden="true">*</span>
      </p>
      <div className="flex gap-3">
        {['true', 'false'].map(option => {
          const selected = value === option
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={[
                'flex items-center gap-2.5 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all',
                selected
                  ? 'border-primary bg-primary-light text-primary ring-1 ring-primary/30'
                  : 'border-border bg-surface text-text-secondary hover:border-border-focus',
              ].join(' ')}
            >
              <span className={[
                'flex size-4 rounded-full border-2 items-center justify-center shrink-0',
                selected ? 'border-primary' : 'border-border-focus',
              ].join(' ')}>
                {selected && <span className="size-2 rounded-full bg-primary" />}
              </span>
              {option.charAt(0).toUpperCase() + option.slice(1)}
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
