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
    correct_answer: ['essay'].includes(data.type) ? null : (data.correct_answer ?? null),
    explanation:    data.explanation || null,
    tags: Array.isArray(data.tags)
      ? data.tags
      : (data.tags ? data.tags.split(',').map(t => t.trim()).filter(Boolean) : []),
  }
}

export async function createQuestion(data) {
  const user = await requireRole('lecturer')
  const supabase = await createClient()

  const parsed = questionSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed. Please check your inputs.' }
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
    return { error: 'Validation failed. Please check your inputs.' }
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
