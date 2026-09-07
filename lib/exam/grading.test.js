import { describe, it, expect } from 'vitest'
import { grade } from './grading'

describe('grade', () => {
  it('mcq: exact match is correct and full marks; mismatch is zero', () => {
    expect(grade('mcq', 'opt-1', 'opt-1', 10)).toEqual({ is_correct: true, marks_awarded: 10 })
    expect(grade('mcq', 'opt-2', 'opt-1', 10)).toEqual({ is_correct: false, marks_awarded: 0 })
  })

  it('true_false: exact match is correct and full marks; mismatch is zero', () => {
    expect(grade('true_false', 'true', 'true', 5)).toEqual({ is_correct: true, marks_awarded: 5 })
    expect(grade('true_false', 'false', 'true', 5)).toEqual({ is_correct: false, marks_awarded: 0 })
  })

  it('fill_blank: matches ignoring case and surrounding whitespace', () => {
    expect(grade('fill_blank', '  Paris  ', 'paris', 4)).toEqual({ is_correct: true, marks_awarded: 4 })
    expect(grade('fill_blank', 'London', 'paris', 4)).toEqual({ is_correct: false, marks_awarded: 0 })
  })

  it('multi_select: exact match (every correct option, nothing else) is correct and full marks', () => {
    expect(grade('multi_select', ['a', 'b'], ['b', 'a'], 10)).toEqual({ is_correct: true, marks_awarded: 10 })
  })

  it('multi_select: awards partial credit for a subset of correct options with no wrong picks', () => {
    // 1 of 2 correct options picked, no incorrect picks: fraction = 1/2
    expect(grade('multi_select', ['a'], ['a', 'b'], 10)).toEqual({ is_correct: false, marks_awarded: 5 })
  })

  it('multi_select: an incorrect pick offsets a correct one rather than zeroing the whole answer', () => {
    // 1 correct + 1 incorrect out of 2 correct options: fraction = (1-1)/2 = 0
    expect(grade('multi_select', ['a', 'c'], ['a', 'b'], 10)).toEqual({ is_correct: false, marks_awarded: 0 })
  })

  it('multi_select: never goes negative — picking everything cannot score below zero', () => {
    // 1 correct + 3 incorrect out of 1 correct option: fraction would be negative, floored at 0
    expect(grade('multi_select', ['a', 'x', 'y', 'z'], ['a'], 10)).toEqual({ is_correct: false, marks_awarded: 0 })
  })

  it('multi_select: an empty selection scores zero, not a crash', () => {
    expect(grade('multi_select', [], ['a', 'b'], 10)).toEqual({ is_correct: false, marks_awarded: 0 })
    expect(grade('multi_select', null, ['a', 'b'], 10)).toEqual({ is_correct: false, marks_awarded: 0 })
  })

  it('unrecognized type (e.g. a legacy essay/short_answer row) grades as zero without throwing', () => {
    expect(grade('essay', 'anything', null, 10)).toEqual({ is_correct: false, marks_awarded: 0 })
  })
})
