import { readDraft } from '@/lib/hooks/formDraftStorage'

export function buildAttemptState(attemptId, responses, startedAt, durationMinutes) {
  const serverAnswers = {}
  for (const r of responses) {
    serverAnswers[r.question_id] = r.student_answer
  }

  const draft = readDraft(`oems:exam:${attemptId}`)

  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)

  return {
    currentIndex:  draft?.currentIndex ?? 0,
    answers:       { ...serverAnswers, ...(draft?.answers ?? {}) },
    flagged:       new Set(draft?.flagged ?? []),
    timeRemaining: Math.max(0, durationMinutes * 60 - elapsed),
  }
}

export function serializeAttemptDraft(state) {
  return {
    answers:      state.answers,
    currentIndex: state.currentIndex,
    flagged:      [...state.flagged],
  }
}
