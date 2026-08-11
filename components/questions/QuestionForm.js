'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, Controller, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Eye, X } from 'lucide-react'

import { questionSchema } from '@/lib/validations/questions'
import { createQuestion, updateQuestion } from '@/lib/actions/questions'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { RichTextEditor } from '@/components/questions/RichTextEditor'
import { TypeSelector } from '@/components/questions/TypeSelector'
import { AnswerOptions, TrueFalseSelector } from '@/components/questions/AnswerOptions'
import { QuestionPreview } from '@/components/questions/QuestionPreview'

const DIFFICULTY_OPTIONS = [
  { value: 'easy',   label: 'Easy',   activeClass: 'bg-success-light text-success border-success/30' },
  { value: 'medium', label: 'Medium', activeClass: 'bg-warning-light text-warning border-warning/30' },
  { value: 'hard',   label: 'Hard',   activeClass: 'bg-danger-light text-danger border-danger/30' },
]

function buildDefaultOptions() {
  return [
    { id: crypto.randomUUID(), text: '' },
    { id: crypto.randomUUID(), text: '' },
  ]
}

function buildDefaults(question) {
  if (question) {
    return {
      course_id:      question.course_id,
      type:           question.type,
      difficulty:     question.difficulty,
      body:           question.body,
      options:        question.options ?? buildDefaultOptions(),
      correct_answer: question.correct_answer,
      explanation:    question.explanation ?? '',
      tags:           question.tags?.join(', ') ?? '',
    }
  }
  return {
    course_id:      '',
    type:           'mcq',
    difficulty:     'medium',
    body:           '',
    options:        buildDefaultOptions(),
    correct_answer: null,
    explanation:    '',
    tags:           '',
  }
}

export function QuestionForm({ question, courses }) {
  const router = useRouter()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const isEdit = !!question

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(questionSchema),
    defaultValues: buildDefaults(question),
  })

  const watchedType = watch('type')
  const watchedValues = watch()

  // Reset answer fields when type changes to avoid stale data
  function handleTypeChange(newType) {
    setValue('type', newType, { shouldValidate: false })
    setValue('correct_answer', null)
    const needsOptions = ['mcq', 'multi_select'].includes(newType)
    if (needsOptions && (!watchedValues.options || watchedValues.options.length < 2)) {
      setValue('options', buildDefaultOptions())
    }
    if (newType === 'true_false') {
      setValue('options', [
        { id: 'true',  text: 'True' },
        { id: 'false', text: 'False' },
      ])
    }
  }

  const onSubmit = async (data) => {
    setSaving(true)
    try {
      // tags stays a raw comma-separated string here, matching questionSchema —
      // the server (parsePayload in lib/actions/questions.js) splits it into
      // an array. Splitting it on the client before sending would make the
      // payload fail that same schema's re-validation on the server, since
      // an array no longer matches `tags: z.string().optional()`.
      const result = isEdit
        ? await updateQuestion(question.id, data)
        : await createQuestion(data)

      if (result?.error) {
        toast.error(result.error)
      } else {
        toast.success(isEdit ? 'Question updated' : 'Question saved')
        router.push('/lecturer/questions')
        router.refresh()
      }
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const showOptions       = ['mcq', 'multi_select'].includes(watchedType)
  const showTrueFalse     = watchedType === 'true_false'
  const showFillBlank     = watchedType === 'fill_blank'

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        {/* ── Sticky action bar ─────────────────────────────────────── */}
        <div className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-3 flex items-center justify-between gap-4">
          <h1 className="text-base font-semibold text-text-primary">
            {isEdit ? 'Edit Question' : 'New Question'}
          </h1>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPreviewOpen(true)}
            >
              <Eye className="size-3.5" />
              Preview
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => router.push('/lecturer/questions')}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={saving} loadingText="Saving…">
              {isEdit ? 'Save changes' : 'Save question'}
            </Button>
          </div>
        </div>

        {/* ── Form body ─────────────────────────────────────────────── */}
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">

          {/* Section 1: Course + Type + Difficulty */}
          <section className="space-y-5">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
              Question settings
            </h2>

            <Controller
              name="course_id"
              control={control}
              render={({ field }) => (
                <Select
                  id="course_id"
                  label="Course"
                  required
                  error={errors.course_id?.message}
                  {...field}
                >
                  <option value="">Select a course…</option>
                  {courses.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.course_code} — {c.course_title}
                    </option>
                  ))}
                </Select>
              )}
            />

            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <TypeSelector
                  value={field.value}
                  onChange={handleTypeChange}
                  error={errors.type?.message}
                />
              )}
            />

            {/* Difficulty toggle — color communicates cognitive weight */}
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium text-text-primary">
                Difficulty <span className="text-danger" aria-hidden="true">*</span>
              </p>
              <Controller
                name="difficulty"
                control={control}
                render={({ field }) => (
                  <div className="flex gap-2">
                    {DIFFICULTY_OPTIONS.map(({ value, label, activeClass }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => field.onChange(value)}
                        className={[
                          'px-4 py-2 rounded-lg border text-sm font-medium transition-all',
                          field.value === value
                            ? activeClass
                            : 'border-border bg-surface text-text-secondary hover:border-border-focus',
                        ].join(' ')}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              />
              {errors.difficulty && (
                <p role="alert" className="text-xs text-danger">{errors.difficulty.message}</p>
              )}
            </div>
          </section>

          {/* Section 2: Question body */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
              Question body
            </h2>
            <Controller
              name="body"
              control={control}
              render={({ field }) => (
                <RichTextEditor
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder={
                    watchedType === 'fill_blank'
                      ? 'Type your sentence here. Use ___ (three underscores) to mark blanks.'
                      : 'Type your question here…'
                  }
                  error={errors.body?.message}
                />
              )}
            />
            {errors.body && (
              <p role="alert" className="text-xs text-danger">{errors.body.message}</p>
            )}
            {watchedType === 'fill_blank' && (
              <p className="text-xs text-text-muted">
                Mark blanks with <code className="font-mono bg-page border border-border rounded px-1">___</code> (three underscores). Example: &ldquo;The capital of Nigeria is ___.&rdquo;
              </p>
            )}
          </section>

          {/* Section 3: Answer options — conditional on type */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
              Answer
            </h2>

            {showOptions && (
              <AnswerOptions
                control={control}
                register={register}
                watch={watch}
                setValue={setValue}
                type={watchedType}
                errors={errors}
              />
            )}

            {showTrueFalse && (
              <Controller
                name="correct_answer"
                control={control}
                render={({ field }) => (
                  <TrueFalseSelector
                    value={field.value}
                    onChange={field.onChange}
                    error={errors.correct_answer?.message}
                  />
                )}
              />
            )}

            {showFillBlank && (
              <Input
                id="correct_answer_fill"
                label="Correct answer"
                placeholder="e.g. Lagos"
                required
                hint="Matching is case-insensitive. Enter the expected answer."
                error={errors.correct_answer?.message}
                {...register('correct_answer')}
              />
            )}
          </section>

          {/* Section 4: Explanation (optional) */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
              Explanation <span className="text-text-muted font-normal normal-case">(optional)</span>
            </h2>
            <Controller
              name="explanation"
              control={control}
              render={({ field }) => (
                <RichTextEditor
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="Explain why the correct answer is correct. Shown to students after results are released."
                />
              )}
            />
          </section>

          {/* Section 5: Tags */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
              Tags <span className="text-text-muted font-normal normal-case">(optional)</span>
            </h2>
            <Input
              id="tags"
              label="Tags"
              placeholder="e.g. thermodynamics, heat transfer, first law"
              hint="Separate tags with commas. Used to filter questions in the bank."
              {...register('tags')}
            />
          </section>
        </div>
      </form>

      <QuestionPreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        question={{
          type: watchedValues.type,
          body: watchedValues.body,
          difficulty: watchedValues.difficulty,
          options: watchedValues.options,
          correct_answer: watchedValues.correct_answer,
        }}
      />
    </>
  )
}
