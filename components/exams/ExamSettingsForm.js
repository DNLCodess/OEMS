'use client'

import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useState } from 'react'
import { examSettingsFormSchema } from '@/lib/validations/exams'
import { createExam, updateExamSettings } from '@/lib/actions/exams'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import {
  Calculator, Lightbulb,
  Plus, Trash2, Info,
} from 'lucide-react'
import { useFormDraft } from '@/lib/hooks/useFormDraft'
import { DraftBanner } from '@/components/shared/DraftBanner'

const CURRENT_SESSION = new Date().getFullYear() + '/' + (new Date().getFullYear() + 1)

function buildDefaults(exam) {
  return exam
    ? {
        ...exam,
        duration_minutes:     exam.duration_minutes,
        entry_window_minutes: exam.entry_window_minutes ?? 10,
        pass_mark:            exam.pass_mark,
        randomise_questions:  exam.randomise_questions ?? false,
        randomise_options:   exam.randomise_options   ?? false,
        instructions:        exam.instructions ?? '',
        exam_mode:           exam.exam_mode ?? 'lab',
        proctoring_enabled:  exam.proctoring_enabled ?? false,
        show_calculator:     exam.show_calculator ?? false,
        tips:                exam.tips?.map(t => ({ value: t })) ?? [],
      }
    : {
        academic_session:     CURRENT_SESSION,
        duration_minutes:     60,
        entry_window_minutes: 10,
        pass_mark:            40,
        randomise_questions: false,
        randomise_options:   false,
        instructions:        '',
        exam_mode:           'lab',
        proctoring_enabled:  false,
        show_calculator:     false,
        tips:                [],
      }
}

export function ExamSettingsForm({ courses, exam = null, lecturerId }) {
  const router = useRouter()
  const isEdit = !!exam

  const {
    register,
    handleSubmit,
    watch,
    control,
    reset,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(examSettingsFormSchema),
    mode: 'onBlur',
    defaultValues: buildDefaults(exam),
  })

  const { fields: tipFields, append: appendTip, remove: removeTip } = useFieldArray({
    control,
    name: 'tips',
  })

  const draftKey = `oems:draft:${lecturerId}:exam:${exam?.id ?? 'new'}`
  const { restored, clearDraft, dismissRestored } = useFormDraft(draftKey, { watch, reset, getValues })

  function handleDiscardDraft() {
    clearDraft()
    reset(buildDefaults(exam))
    dismissRestored()
  }

  async function onSubmit(data) {
    const payload = {
      ...data,
      // Unwrap tips from { value } objects
      tips: (data.tips ?? []).map(t => t.value).filter(Boolean),
      // Proctoring UI has been retired — every exam is lab-delivered now.
      proctoring_enabled: false,
    }

    const result = isEdit
      ? await updateExamSettings(exam.id, payload)
      : await createExam(payload)

    if (result?.error) {
      toast.error(result.error)
      return
    }

    toast.success(isEdit ? 'Exam settings saved.' : 'Exam created.')
    clearDraft()
    router.push(`/lecturer/exams/${result.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-8">
      {restored && (
        <DraftBanner onDiscard={handleDiscardDraft} onDismiss={dismissRestored} />
      )}

      {/* ── Basic info ──────────────────────────────────────────────────────── */}
      <section className="bg-surface border border-border rounded-xl p-6 space-y-5">
        <h2 className="text-base font-semibold text-text-primary">Basic Information</h2>

        <Input
          label="Exam Title"
          id="title"
          required
          placeholder="e.g. CSC 301 — End of Semester Examination"
          error={errors.title?.message}
          {...register('title')}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="Course" id="course_id" required error={errors.course_id?.message} {...register('course_id')}>
            <option value="">Select a course</option>
            {courses.map(c => (
              <option key={c.id} value={c.id}>{c.course_code} — {c.course_title}</option>
            ))}
          </Select>
          <Select label="Exam Type" id="exam_type" required error={errors.exam_type?.message} {...register('exam_type')}>
            <option value="">Select type</option>
            <option value="ca">Continuous Assessment (C.A.)</option>
            <option value="mid_semester">Mid-Semester Test</option>
            <option value="end_of_semester">End of Semester Examination</option>
          </Select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Academic Session" id="academic_session" required
            placeholder="e.g. 2024/2025" hint="Format: YYYY/YYYY"
            error={errors.academic_session?.message}
            {...register('academic_session')}
          />
          <Select label="Semester" id="semester" required error={errors.semester?.message} {...register('semester')}>
            <option value="">Select semester</option>
            <option value="first">First Semester</option>
            <option value="second">Second Semester</option>
          </Select>
        </div>

        <Textarea
          label="Instructions"
          id="instructions"
          rows={3}
          placeholder="e.g. Answer all questions. Time management is key."
          hint="Displayed on the exam lobby screen before students start."
          error={errors.instructions?.message}
          {...register('instructions')}
        />
      </section>

      {/* ── Timing & scoring ────────────────────────────────────────────────── */}
      <section className="bg-surface border border-border rounded-xl p-6 space-y-5">
        <h2 className="text-base font-semibold text-text-primary">Timing & Scoring</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Duration (minutes)" id="duration_minutes" type="number" required min={5} max={300}
            hint="How long each student gets to answer, once they start."
            error={errors.duration_minutes?.message}
            {...register('duration_minutes')}
          />
          <Input
            label="Pass Mark (%)" id="pass_mark" type="number" required min={0} max={100}
            hint="Minimum percentage to pass."
            error={errors.pass_mark?.message}
            {...register('pass_mark')}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Entry Window (minutes)" id="entry_window_minutes" type="number" required min={1} max={180}
            hint="How long after you click Go Live new students may still start."
            error={errors.entry_window_minutes?.message}
            {...register('entry_window_minutes')}
          />
        </div>
      </section>

      {/* ── Delivery ─────────────────────────────────────────────────────────── */}
      <section className="bg-surface border border-border rounded-xl p-6 space-y-3">
        <h2 className="text-base font-semibold text-text-primary">Delivery</h2>
        <div className="flex items-start gap-2 bg-primary-light border border-primary/20 rounded-lg px-3 py-2.5">
          <Info size={13} className="text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-primary/80">
            After saving, go to the exam detail page to generate an <strong>access code</strong>. Display it on a projector or share it with students in the lab — they enter it with their matric number to begin. No navigation, just the exam.
          </p>
        </div>
      </section>

      {/* ── Options ─────────────────────────────────────────────────────────── */}
      <section className="bg-surface border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-text-primary">Options</h2>
        <p className="text-sm text-text-muted">Randomisation reduces answer-sharing between students.</p>

        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 rounded accent-primary" {...register('randomise_questions')} />
          <span className="text-sm text-text-primary">Randomise question order for each student</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 rounded accent-primary" {...register('randomise_options')} />
          <span className="text-sm text-text-primary">Randomise MCQ option order for each student</span>
        </label>
      </section>

      {/* ── Tools & Aids ────────────────────────────────────────────────────── */}
      <section className="bg-surface border border-border rounded-xl p-6 space-y-6">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Tools & Aids</h2>
          <p className="text-sm text-text-muted mt-1">
            Optional tools students can access during the exam.
          </p>
        </div>

        {/* Calculator */}
        <div className="border border-border rounded-xl p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-0.5 w-4 h-4 rounded accent-primary" {...register('show_calculator')} />
            <div>
              <div className="flex items-center gap-2">
                <Calculator size={15} className="text-text-muted" />
                <span className="text-sm font-medium text-text-primary">Enable in-exam calculator</span>
              </div>
              <p className="text-xs text-text-muted mt-0.5">
                A floating scientific calculator button appears in the exam toolbar. Students can open and close it at any time. Includes basic arithmetic and scientific functions (sin, cos, tan, log, √, x²).
              </p>
            </div>
          </label>
        </div>

        {/* Tips */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb size={15} className="text-text-muted" />
            <span className="text-sm font-medium text-text-primary">Exam tips</span>
          </div>
          <p className="text-xs text-text-muted">
            Tips appear as a floating panel students can open at any time during the exam. Useful for formulas, reminders, or approach guidance.
          </p>

          <div className="space-y-2">
            {tipFields.map((field, index) => (
              <div key={field.id} className="flex items-start gap-2">
                <input
                  type="text"
                  placeholder={`Tip ${index + 1}…`}
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-focus focus:ring-2 focus:ring-primary/15"
                  {...register(`tips.${index}.value`)}
                />
                <button
                  type="button"
                  onClick={() => removeTip(index)}
                  className="shrink-0 p-2 rounded-lg text-text-muted hover:text-danger hover:bg-danger-light transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>

          {tipFields.length < 10 && (
            <button
              type="button"
              onClick={() => appendTip({ value: '' })}
              className="flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Plus size={14} />
              Add a tip
            </button>
          )}
        </div>
      </section>

      {/* ── Actions ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3 pb-8">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : isEdit ? 'Save Settings' : 'Create Exam'}
        </Button>
      </div>
    </form>
  )
}
