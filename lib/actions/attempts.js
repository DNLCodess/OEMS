'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/dal'

const EXAM_ACCESS_REQUIRED_ERROR = {
  error: 'Please enter this exam using your matric number and access code.',
}

// A result-lookup session (matric number + date of birth) must never be
// able to start, save answers to, or submit an exam attempt — only a
// session minted via the exam-access channel (matric number + access code)
// may take exams. `session_channel` lives in the auth user's app_metadata,
// which only the admin API can set (never the browser), and we re-fetch it
// with a live getUser() call (not getSession(), which trusts a locally
// decoded JWT) so nothing client-controlled can flip this check.
function hasExamAccessChannel(authUser) {
  return authUser?.app_metadata?.session_channel === 'exam_access'
}

// startExam additionally requires the session to have been verified
// against THIS specific exam (see mintStudentSession's verified_exam_id).
// Without this, any exam-access-channel session — verified for some other
// live exam — could be used to start an exam whose access code was never
// entered. saveAnswer/submitExam don't need this check: by the time an
// attempt row exists, it was only created through this gate, and ownership
// is separately enforced by attempts.student_id = auth.uid().
function hasExamAccessFor(authUser, examId) {
  return hasExamAccessChannel(authUser) && Boolean(examId) && authUser?.app_metadata?.verified_exam_id === examId
}

// ─── Start / resume ──────────────────────────────────────────────────────────

export async function startExam(examId) {
  const user     = await requireRole('student')
  const supabase = await createClient()

  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!hasExamAccessFor(authUser, examId)) return EXAM_ACCESS_REQUIRED_ERROR

  // Verify exam is live and accessible to this student (RLS handles access check)
  const { data: exam } = await supabase
    .from('exams')
    .select('id, status, university_id')
    .eq('id', examId)
    .eq('university_id', user.university_id)
    .single()

  if (!exam) return { error: 'Exam not found.' }
  if (exam.status !== 'live') return { error: 'This exam is not currently active.' }

  // Check for an existing attempt — resume if in_progress, block if done
  const { data: existing } = await supabase
    .from('attempts')
    .select('id, status')
    .eq('exam_id', examId)
    .eq('student_id', user.id)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'in_progress') return { attemptId: existing.id }
    return { error: 'You have already submitted this exam.' }
  }

  const { data: attempt, error } = await supabase
    .from('attempts')
    .insert({ exam_id: examId, student_id: user.id, status: 'in_progress' })
    .select('id')
    .single()

  if (error) {
    console.error('[startExam]', error.message)
    return { error: 'Failed to start exam. Please try again.' }
  }

  return { attemptId: attempt.id }
}


// ─── Save answer (auto-save, debounced on client) ────────────────────────────

export async function saveAnswer(attemptId, questionId, answer) {
  const user     = await requireRole('student')
  const supabase = await createClient()

  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!hasExamAccessChannel(authUser)) return EXAM_ACCESS_REQUIRED_ERROR

  // Ownership + status check
  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, status')
    .eq('id', attemptId)
    .eq('student_id', user.id)
    .single()

  if (!attempt)                         return { error: 'Attempt not found.' }
  if (attempt.status !== 'in_progress') return { error: 'Exam already submitted.' }

  const { error } = await supabase
    .from('responses')
    .upsert(
      { attempt_id: attemptId, question_id: questionId, student_answer: answer },
      { onConflict: 'attempt_id,question_id' }
    )

  if (error) {
    console.error('[saveAnswer]', error.message)
    return { error: 'Failed to save answer.' }
  }

  return { ok: true }
}


// ─── Auto-grade helpers ───────────────────────────────────────────────────────

function grade(type, studentAnswer, correctAnswer, marks) {
  let isCorrect = false

  if (type === 'mcq' || type === 'true_false') {
    isCorrect = studentAnswer === correctAnswer
  } else if (type === 'multi_select') {
    const sa = Array.isArray(studentAnswer) ? [...studentAnswer].sort().join(',') : ''
    const ca = Array.isArray(correctAnswer) ? [...correctAnswer].sort().join(',') : ''
    isCorrect = sa === ca && sa !== ''
  } else if (type === 'fill_blank') {
    isCorrect =
      typeof studentAnswer === 'string' &&
      studentAnswer.trim().toLowerCase() === String(correctAnswer ?? '').trim().toLowerCase()
  } else {
    // Every question type left in the bank auto-grades; anything else (a
    // legacy essay/short_answer row, or a future type added to the enum
    // without updating this function) is unrecognized. Log loudly so this
    // is never silently indistinguishable from "genuinely answered wrong" —
    // but still return a safe result so grading never throws and blocks
    // submission.
    console.error('[grade] unrecognized question type', type)
  }

  return { is_correct: isCorrect, marks_awarded: isCorrect ? marks : 0 }
}


// ─── Submit exam ─────────────────────────────────────────────────────────────

export async function submitExam(attemptId) {
  const user     = await requireRole('student')
  const supabase = await createClient()

  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!hasExamAccessChannel(authUser)) return EXAM_ACCESS_REQUIRED_ERROR

  // Fetch and lock the attempt
  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, exam_id, status, student_id')
    .eq('id', attemptId)
    .eq('student_id', user.id)
    .single()

  if (!attempt)                         return { error: 'Attempt not found.' }
  if (attempt.status !== 'in_progress') return { error: 'Exam already submitted.' }

  // Fetch exam questions WITH correct answers (server-only; never reaches client)
  const { data: examQuestions } = await supabase
    .from('exam_questions')
    .select('question_id, marks, question_bank:question_id ( type, correct_answer )')
    .eq('exam_id', attempt.exam_id)

  // Fetch the student's saved responses
  const { data: savedResponses } = await supabase
    .from('responses')
    .select('question_id, student_answer')
    .eq('attempt_id', attemptId)

  const responseMap = new Map(
    (savedResponses ?? []).map(r => [r.question_id, r.student_answer])
  )

  // Grade every question
  let totalScore = 0
  const gradedRows = []

  for (const eq of examQuestions ?? []) {
    const qb            = eq.question_bank
    const studentAnswer = responseMap.get(eq.question_id) ?? null
    const { is_correct, marks_awarded } = grade(qb.type, studentAnswer, qb.correct_answer, eq.marks)
    totalScore += marks_awarded

    gradedRows.push({
      attempt_id:    attemptId,
      question_id:   eq.question_id,
      student_answer: studentAnswer,
      is_correct,
      marks_awarded,
    })
  }

  // Upsert graded responses (covers both saved + unsaved questions)
  if (gradedRows.length > 0) {
    await supabase
      .from('responses')
      .upsert(gradedRows, { onConflict: 'attempt_id,question_id' })
  }

  // Fetch pass_mark
  const { data: exam } = await supabase
    .from('exams')
    .select('pass_mark')
    .eq('id', attempt.exam_id)
    .single()

  const totalPossible = (examQuestions ?? []).reduce((s, eq) => s + eq.marks, 0)
  const percentage    = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : 0
  const passed        = percentage >= (exam?.pass_mark ?? 50)

  // Mark attempt submitted
  await supabase
    .from('attempts')
    .update({
      status:       'submitted',
      submitted_at: new Date().toISOString(),
      total_score:  totalScore,
    })
    .eq('id', attemptId)

  // Results are visible to the student immediately — every remaining
  // question type auto-grades on submission, so there's no "waiting on
  // manual grading" state left to protect against. This insert must go
  // through the admin client: `results` RLS only grants lecturer/admin
  // write access and student SELECT of their own rows — there is no
  // student-INSERT policy, and there shouldn't be one, since a
  // student-writable insert would let a crafted request forge its own
  // final_score/passed (the same class of gap a prior RLS hardening pass
  // closed for attempts.total_score). Everything else in this function
  // stays on the student-session `supabase` client, correctly scoped by
  // existing RLS.
  const adminClient = createAdminClient()
  const { error: resultError } = await adminClient
    .from('results')
    .insert({
      attempt_id:  attemptId,
      student_id:  user.id,
      exam_id:     attempt.exam_id,
      final_score: totalScore,
      passed,
      released_at: new Date().toISOString(),
    })

  if (resultError) {
    // Non-fatal — attempt is already submitted; log and continue
    console.error('[submitExam] result insert', resultError.message)
  }

  revalidatePath(`/student/exams/${attempt.exam_id}/result`)
  return { ok: true, examId: attempt.exam_id }
}
