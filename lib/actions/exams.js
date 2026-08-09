'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/dal'
import { examSettingsSchema } from '@/lib/validations/exams'
import { randomInt } from 'crypto'

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getOwnedExam(supabase, examId, userId, universityId) {
  const { data, error } = await supabase
    .from('exams')
    .select('id, status, created_by, university_id')
    .eq('id', examId)
    .eq('university_id', universityId)
    .single()

  if (error || !data || data.created_by !== userId) return null
  return data
}

function revalidateExam(id) {
  revalidatePath('/lecturer/exams')
  revalidatePath(`/lecturer/exams/${id}`)
  revalidatePath(`/lecturer/exams/${id}/edit`)
  revalidatePath(`/lecturer/exams/${id}/preview`)
}

// ─── Settings ───────────────────────────────────────────────────────────────

export async function createExam(data) {
  const user = await requireRole('lecturer')
  const supabase = await createClient()

  const parsed = examSettingsSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed. Please check your inputs.' }
  }

  const { data: course } = await supabase
    .from('courses')
    .select('id')
    .eq('id', parsed.data.course_id)
    .eq('university_id', user.university_id)
    .single()

  if (!course) return { error: 'Selected course not found.' }

  const { data: exam, error } = await supabase
    .from('exams')
    .insert({
      ...parsed.data,
      university_id: user.university_id,
      created_by:    user.id,
      status:        'draft',
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createExam]', error.message)
    return { error: 'Failed to create exam. Please try again.' }
  }

  revalidatePath('/lecturer/exams')
  return { id: exam.id }
}

export async function updateExamSettings(examId, data) {
  const user = await requireRole('lecturer')
  const supabase = await createClient()

  const parsed = examSettingsSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed. Please check your inputs.' }
  }

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }
  if (exam.status === 'closed') return { error: 'Closed exams cannot be edited.' }

  const { error } = await supabase
    .from('exams')
    .update(parsed.data)
    .eq('id', examId)

  if (error) {
    console.error('[updateExamSettings]', error.message)
    return { error: 'Failed to update exam.' }
  }

  revalidateExam(examId)
  return { id: examId }
}

// ─── Questions ───────────────────────────────────────────────────────────────

export async function addQuestionToExam(examId, questionId) {
  const user = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }
  if (exam.status === 'live' || exam.status === 'closed') {
    return { error: 'Cannot add questions to a live or closed exam.' }
  }

  // Verify question belongs to this university and isn't archived
  const { data: question } = await supabase
    .from('question_bank')
    .select('id, type, body, difficulty, course_id, courses(course_code)')
    .eq('id', questionId)
    .eq('university_id', user.university_id)
    .eq('is_archived', false)
    .single()

  if (!question) return { error: 'Question not found.' }

  // Get the current max order_index
  const { data: existing } = await supabase
    .from('exam_questions')
    .select('order_index')
    .eq('exam_id', examId)
    .order('order_index', { ascending: false })
    .limit(1)

  const nextIndex = existing?.length ? existing[0].order_index + 1 : 0

  const { data: examQuestion, error } = await supabase
    .from('exam_questions')
    .insert({ exam_id: examId, question_id: questionId, order_index: nextIndex, marks: 1 })
    .select('id, order_index, marks, question_id')
    .single()

  if (error) {
    if (error.code === '23505') return { error: 'This question is already in the exam.' }
    console.error('[addQuestionToExam]', error.message)
    return { error: 'Failed to add question.' }
  }

  revalidateExam(examId)
  return { examQuestion: { ...examQuestion, question_bank: question } }
}

export async function removeQuestionFromExam(examId, questionId) {
  const user = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }
  if (exam.status === 'live' || exam.status === 'closed') {
    return { error: 'Cannot remove questions from a live or closed exam.' }
  }

  const { error } = await supabase
    .from('exam_questions')
    .delete()
    .eq('exam_id', examId)
    .eq('question_id', questionId)

  if (error) {
    console.error('[removeQuestionFromExam]', error.message)
    return { error: 'Failed to remove question.' }
  }

  revalidateExam(examId)
  return { ok: true }
}

export async function updateQuestionMarks(examId, questionId, marks) {
  const user = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }

  const parsedMarks = parseInt(marks, 10)
  if (!parsedMarks || parsedMarks < 1) return { error: 'Marks must be at least 1.' }

  const { error } = await supabase
    .from('exam_questions')
    .update({ marks: parsedMarks })
    .eq('exam_id', examId)
    .eq('question_id', questionId)

  if (error) {
    console.error('[updateQuestionMarks]', error.message)
    return { error: 'Failed to update marks.' }
  }

  revalidateExam(examId)
  return { ok: true }
}

export async function reorderExamQuestions(examId, orderedQuestionIds) {
  const user = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }

  // Update each question's order_index to match the new array position
  const updates = orderedQuestionIds.map((questionId, index) =>
    supabase
      .from('exam_questions')
      .update({ order_index: index })
      .eq('exam_id', examId)
      .eq('question_id', questionId)
  )

  const results = await Promise.all(updates)
  const failed = results.find(r => r.error)
  if (failed) {
    console.error('[reorderExamQuestions]', failed.error.message)
    return { error: 'Failed to save question order.' }
  }

  revalidateExam(examId)
  return { ok: true }
}

// ─── Access code ──────────────────────────────────────────────────────────

function randomAccessCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no O, 0, I, 1 — visually ambiguous
  return Array.from({ length: 6 }, () => chars[randomInt(chars.length)]).join('')
}

export async function generateAccessCode(examId) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }

  // Generate a unique code (retry on collision — extremely rare)
  let code, attempts = 0
  while (attempts < 5) {
    code = randomAccessCode()
    const { data: existing } = await supabase
      .from('exams').select('id').eq('access_code', code).maybeSingle()
    if (!existing) break
    attempts++
  }

  const { error } = await supabase
    .from('exams')
    .update({ access_code: code })
    .eq('id', examId)

  if (error) return { error: 'Failed to generate access code.' }

  revalidateExam(examId)
  return { access_code: code }
}

// ─── Exam access allow-list ──────────────────────────────────────────────────

export async function searchEligibleStudents(examId, query) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }

  const trimmed = query?.trim() ?? ''
  if (trimmed.length < 2) return { students: [] }

  // PostgREST builds its .or() filter by parsing this string — comma
  // separates conditions and parentheses group values, so both are
  // stripped to prevent a search query from injecting extra filter terms.
  // Two-pass approach: first strip matched parenthesized groups, then any
  // leftover structural characters (handles nested parens and injection attempts).
  const safeQuery = trimmed.replace(/\([^)]*\)/g, '').replace(/[,()]/g, '')

  const { data: students, error } = await supabase
    .from('users')
    .select('id, full_name, matric_number')
    .eq('university_id', user.university_id)
    .eq('role', 'student')
    .eq('is_active', true)
    .or(`matric_number.ilike.%${safeQuery}%,full_name.ilike.%${safeQuery}%`)
    .order('full_name')
    .limit(20)

  if (error) return { error: 'Search failed.' }

  const { data: existing } = await supabase
    .from('exam_access')
    .select('user_id')
    .eq('exam_id', examId)

  const existingIds = new Set((existing ?? []).map(row => row.user_id))

  return {
    students: (students ?? []).map(student => ({ ...student, added: existingIds.has(student.id) })),
  }
}

export async function addExamAccessStudent(examId, studentId) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }

  if (exam.status === 'live' || exam.status === 'closed') {
    return { error: 'Exam access cannot be changed once the exam has started.' }
  }

  const { data: student } = await supabase
    .from('users')
    .select('id')
    .eq('id', studentId)
    .eq('university_id', user.university_id)
    .eq('role', 'student')
    .eq('is_active', true)
    .maybeSingle()

  if (!student) return { error: 'Student not found.' }

  const { error } = await supabase
    .from('exam_access')
    .insert({ exam_id: examId, user_id: studentId })

  // 23505 = unique violation — student is already on the allow-list, which
  // is the outcome the caller wanted anyway.
  if (error && error.code !== '23505') {
    return { error: 'Failed to add student.' }
  }

  revalidatePath(`/lecturer/exams/${examId}`)
  return { ok: true }
}

export async function removeExamAccessStudent(examId, studentId) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }

  if (exam.status === 'live' || exam.status === 'closed') {
    return { error: 'Exam access cannot be changed once the exam has started.' }
  }

  const { error } = await supabase
    .from('exam_access')
    .delete()
    .eq('exam_id', examId)
    .eq('user_id', studentId)

  if (error) return { error: 'Failed to remove student.' }

  revalidatePath(`/lecturer/exams/${examId}`)
  return { ok: true }
}

// ─── Status workflow ─────────────────────────────────────────────────────────

const VALID_TRANSITIONS = {
  draft:     ['scheduled'],
  scheduled: ['draft', 'live'],
  live:      ['closed'],
  closed:    [],
}

export async function updateExamStatus(examId, newStatus) {
  const user = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }

  if (!VALID_TRANSITIONS[exam.status]?.includes(newStatus)) {
    return { error: `Cannot transition from ${exam.status} to ${newStatus}.` }
  }

  // Guard: must have at least one question to schedule or go live
  if (newStatus === 'scheduled' || newStatus === 'live') {
    const { count } = await supabase
      .from('exam_questions')
      .select('id', { count: 'exact', head: true })
      .eq('exam_id', examId)

    if (!count || count === 0) {
      return { error: 'Add at least one question before scheduling this exam.' }
    }
  }

  const { error } = await supabase
    .from('exams')
    .update({ status: newStatus })
    .eq('id', examId)

  if (error) {
    console.error('[updateExamStatus]', error.message)
    return { error: 'Failed to update exam status.' }
  }

  revalidateExam(examId)
  return { status: newStatus }
}
