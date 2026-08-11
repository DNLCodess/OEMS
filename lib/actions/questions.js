'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/dal'
import { questionSchema } from '@/lib/validations/questions'

function parsePayload(data) {
  return {
    course_id:      data.course_id,
    type:           data.type,
    difficulty:     data.difficulty,
    body:           data.body,
    options:        ['mcq', 'multi_select', 'true_false'].includes(data.type)
                      ? (data.options ?? null)
                      : null,
    correct_answer: data.correct_answer ?? null,
    explanation:    data.explanation || null,
    tags: data.tags ? data.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
  }
}

// Surfaces the schema's own field-specific message (e.g. "Add at least 2
// options") instead of a generic one — questionSchema already writes a
// helpful message for every failure case, so there's no reason to discard it.
function firstValidationMessage(zodError) {
  // 'invalid_type' issues are Zod's own auto-generated message for a raw
  // shape mismatch (e.g. 'Invalid input: expected string, received array')
  // — that's a developer-facing signal pointing at a bug in our own code,
  // never something an end user typed wrong, so it must never reach them.
  // Every other issue code in this schema (too_small, too_big, custom,
  // required_error, etc.) always carries a message we wrote on purpose.
  const authored = zodError.issues.find(i => i.code !== 'invalid_type')
  return authored?.message ?? 'Please check your inputs and try again.'
}

export async function createQuestion(data) {
  const user = await requireRole('lecturer')
  const supabase = await createClient()

  const parsed = questionSchema.safeParse(data)
  if (!parsed.success) {
    return { error: firstValidationMessage(parsed.error) }
  }

  // Verify the selected course belongs to this university
  const { data: course, error: courseErr } = await supabase
    .from('courses')
    .select('id')
    .eq('id', parsed.data.course_id)
    .eq('university_id', user.university_id)
    .single()

  if (courseErr || !course) {
    return { error: 'Selected course not found.' }
  }

  const { data: question, error } = await supabase
    .from('question_bank')
    .insert({
      ...parsePayload(parsed.data),
      university_id: user.university_id,
      created_by:    user.id,
      is_archived:   false,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createQuestion]', error.message)
    return { error: 'Failed to save question. Please try again.' }
  }

  revalidatePath('/lecturer/questions')
  return { id: question.id }
}

export async function updateQuestion(id, data) {
  const user = await requireRole('lecturer')
  const supabase = await createClient()

  const parsed = questionSchema.safeParse(data)
  if (!parsed.success) {
    return { error: firstValidationMessage(parsed.error) }
  }

  // Verify the question belongs to this lecturer
  const { data: existing } = await supabase
    .from('question_bank')
    .select('id, created_by')
    .eq('id', id)
    .eq('university_id', user.university_id)
    .single()

  if (!existing || existing.created_by !== user.id) {
    return { error: 'Question not found.' }
  }

  const { error } = await supabase
    .from('question_bank')
    .update(parsePayload(parsed.data))
    .eq('id', id)

  if (error) {
    console.error('[updateQuestion]', error.message)
    return { error: 'Failed to update question. Please try again.' }
  }

  revalidatePath('/lecturer/questions')
  revalidatePath(`/lecturer/questions/${id}/edit`)
  return { id }
}

export async function archiveQuestion(id) {
  const user = await requireRole('lecturer')
  const supabase = await createClient()

  // Verify ownership before archiving
  const { data: existing } = await supabase
    .from('question_bank')
    .select('id, created_by')
    .eq('id', id)
    .eq('university_id', user.university_id)
    .single()

  if (!existing || existing.created_by !== user.id) {
    return { error: 'Question not found.' }
  }

  const { error } = await supabase
    .from('question_bank')
    .update({ is_archived: true })
    .eq('id', id)

  if (error) {
    console.error('[archiveQuestion]', error.message)
    return { error: 'Failed to archive question.' }
  }

  revalidatePath('/lecturer/questions')
}
