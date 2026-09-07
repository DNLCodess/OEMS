// Deterministic (seeded) Fisher-Yates shuffle — same seed always produces the
// same order, so a reload of the same attempt doesn't re-shuffle underneath
// the student, but two different attempts (different seeds) get different
// orders.
export function deterministicShuffle(arr, seed) {
  const result = [...arr]
  let s = seed
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    const j = Math.abs(s) % (i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// Applies an exam's randomise_questions/randomise_options settings to an
// already-assembled question list. `seed` is derived once per attempt (not
// per render) by the caller, so ordering is stable across reloads of the
// same attempt.
export function applyExamRandomization(questions, exam, seed) {
  let result = questions

  if (exam.randomise_questions) {
    result = deterministicShuffle(result, seed)
  }

  if (exam.randomise_options) {
    result = result.map((q, i) => {
      if (!Array.isArray(q.options) || q.options.length < 2) return q
      // Distinct per-question seed so every question in the exam doesn't
      // shuffle into the same relative pattern for a given student.
      return { ...q, options: deterministicShuffle(q.options, seed + i * 7919) }
    })
  }

  return result
}
