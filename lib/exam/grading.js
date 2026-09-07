export function grade(type, studentAnswer, correctAnswer, marks) {
  if (type === 'mcq' || type === 'true_false') {
    const isCorrect = studentAnswer === correctAnswer
    return { is_correct: isCorrect, marks_awarded: isCorrect ? marks : 0 }
  }

  if (type === 'multi_select') {
    return gradeMultiSelect(studentAnswer, correctAnswer, marks)
  }

  if (type === 'fill_blank') {
    const isCorrect =
      typeof studentAnswer === 'string' &&
      studentAnswer.trim().toLowerCase() === String(correctAnswer ?? '').trim().toLowerCase()
    return { is_correct: isCorrect, marks_awarded: isCorrect ? marks : 0 }
  }

  // Every question type left in the bank auto-grades; anything else (a
  // legacy essay/short_answer row, or a future type added to the enum
  // without updating this function) is unrecognized. Log loudly so this
  // is never silently indistinguishable from "genuinely answered wrong" —
  // but still return a safe result so grading never throws and blocks
  // submission.
  console.error('[grade] unrecognized question type', type)
  return { is_correct: false, marks_awarded: 0 }
}

// Partial credit across the array of correct options: each correctly-picked
// option earns an equal share of the marks, each incorrectly-picked option
// costs an equal share, floored at 0 — so guessing every option never beats
// picking nothing, and a partially-right answer scores between zero and full
// marks rather than only ever landing on one of those two extremes.
// `is_correct` stays true only for an exact match (every correct option
// picked, nothing else), matching what "correct" means everywhere else the
// flag is read (result breakdown coloring, pass/fail-adjacent displays).
function gradeMultiSelect(studentAnswer, correctAnswer, marks) {
  const correctSet  = new Set(Array.isArray(correctAnswer) ? correctAnswer : [])
  const selectedSet = new Set(Array.isArray(studentAnswer) ? studentAnswer : [])

  if (correctSet.size === 0 || selectedSet.size === 0) {
    return { is_correct: false, marks_awarded: 0 }
  }

  let correctPicks = 0
  let incorrectPicks = 0
  for (const option of selectedSet) {
    if (correctSet.has(option)) correctPicks++
    else incorrectPicks++
  }

  const isExactMatch = correctPicks === correctSet.size && incorrectPicks === 0
  if (isExactMatch) return { is_correct: true, marks_awarded: marks }

  const fraction     = Math.max(0, (correctPicks - incorrectPicks) / correctSet.size)
  const marksAwarded = Math.round(fraction * marks)
  return { is_correct: false, marks_awarded: marksAwarded }
}
