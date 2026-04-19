'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/dal'

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getOwnedExam(supabase, examId, userId, universityId) {
  const { data } = await supabase
    .from('exams')
    .select('id, status, created_by, university_id, pass_mark')
    .eq('id', examId)
    .eq('university_id', universityId)
    .single()
  if (!data || data.created_by !== userId) return null
  return data
}

function revalidateResults(examId, attemptId) {
  revalidatePath(`/lecturer/exams/${examId}/results`)
  if (attemptId) revalidatePath(`/lecturer/exams/${examId}/results/${attemptId}`)
}

// ─── Release / unrelease all results for an exam ─────────────────────────────

export async function releaseResults(examId) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }
  if (exam.status !== 'closed') return { error: 'Only closed exams can have results released.' }

  const { error } = await supabase
    .from('results')
    .update({ released_at: new Date().toISOString() })
    .eq('exam_id', examId)
    .is('released_at', null)

  if (error) {
    console.error('[releaseResults]', error.message)
    return { error: 'Failed to release results.' }
  }

  revalidateResults(examId)
  return { ok: true }
}

export async function unreleaseResults(examId) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }

  const { error } = await supabase
    .from('results')
    .update({ released_at: null })
    .eq('exam_id', examId)
    .not('released_at', 'is', null)

  if (error) {
    console.error('[unreleaseResults]', error.message)
    return { error: 'Failed to unrelease results.' }
  }

  revalidateResults(examId)
  return { ok: true }
}


// ─── Manual grading (essay / short_answer) ────────────────────────────────────

export async function updateResponseGrade(examId, responseId, marksAwarded, feedback) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }

  const marks = parseInt(marksAwarded, 10)
  if (isNaN(marks) || marks < 0) return { error: 'Invalid marks value.' }

  // Verify the response belongs to this exam
  const { data: response } = await supabase
    .from('responses')
    .select('id, attempt_id')
    .eq('id', responseId)
    .single()

  if (!response) return { error: 'Response not found.' }

  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, exam_id')
    .eq('id', response.attempt_id)
    .eq('exam_id', examId)
    .single()

  if (!attempt) return { error: 'Response does not belong to this exam.' }

  const { error } = await supabase
    .from('responses')
    .update({
      marks_awarded:    marks,
      teacher_feedback: feedback?.trim() || null,
    })
    .eq('id', responseId)

  if (error) {
    console.error('[updateResponseGrade]', error.message)
    return { error: 'Failed to save grade.' }
  }

  return { ok: true }
}


// ─── Recalculate total score after manual grading ────────────────────────────

export async function recalculateResult(examId, attemptId) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }

  // Sum all marks_awarded for this attempt
  const { data: responses } = await supabase
    .from('responses')
    .select('marks_awarded')
    .eq('attempt_id', attemptId)

  const totalScore = (responses ?? []).reduce((s, r) => s + (r.marks_awarded ?? 0), 0)

  // Get total possible marks
  const { data: examQuestions } = await supabase
    .from('exam_questions')
    .select('marks')
    .eq('exam_id', examId)

  const totalPossible = (examQuestions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)
  const percentage    = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : 0
  const passed        = percentage >= exam.pass_mark

  // Update attempt
  await supabase
    .from('attempts')
    .update({ total_score: totalScore, status: 'graded' })
    .eq('id', attemptId)

  // Upsert result (handles case where result row doesn't exist yet)
  const { data: attempt } = await supabase
    .from('attempts')
    .select('student_id')
    .eq('id', attemptId)
    .single()

  const { error } = await supabase
    .from('results')
    .upsert(
      {
        attempt_id:  attemptId,
        student_id:  attempt?.student_id,
        exam_id:     examId,
        final_score: totalScore,
        passed,
      },
      { onConflict: 'attempt_id' }
    )

  if (error) {
    console.error('[recalculateResult]', error.message)
    return { error: 'Failed to update result.' }
  }

  revalidateResults(examId, attemptId)
  return { ok: true, totalScore, passed }
}
