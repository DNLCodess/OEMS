import { describe, it, expect } from 'vitest'
import { deterministicShuffle, applyExamRandomization } from './randomize'

describe('deterministicShuffle', () => {
  it('is a permutation of the input — same elements, same length', () => {
    const input = ['a', 'b', 'c', 'd', 'e']
    const result = deterministicShuffle(input, 12345)
    expect(result).toHaveLength(input.length)
    expect([...result].sort()).toEqual([...input].sort())
  })

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c']
    const copy = [...input]
    deterministicShuffle(input, 42)
    expect(input).toEqual(copy)
  })

  it('same seed produces the same order every time (stable across reloads)', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(deterministicShuffle(input, 999)).toEqual(deterministicShuffle(input, 999))
  })

  it('different seeds tend to produce different orders', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const a = deterministicShuffle(input, 1)
    const b = deterministicShuffle(input, 2)
    expect(a).not.toEqual(b)
  })
})

describe('applyExamRandomization', () => {
  const questions = [
    { id: 'q1', options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }, { id: 'o3', text: 'C' }] },
    { id: 'q2', options: [{ id: 'o4', text: 'D' }, { id: 'o5', text: 'E' }] },
    { id: 'q3', options: null }, // fill_blank-style question with no options
  ]

  it('leaves question order and option order untouched when both flags are off', () => {
    const result = applyExamRandomization(questions, { randomise_questions: false, randomise_options: false }, 7)
    expect(result.map(q => q.id)).toEqual(['q1', 'q2', 'q3'])
    expect(result[0].options.map(o => o.id)).toEqual(['o1', 'o2', 'o3'])
  })

  it('reorders questions when randomise_questions is on, without touching option order', () => {
    const result = applyExamRandomization(questions, { randomise_questions: true, randomise_options: false }, 7)
    expect([...result.map(q => q.id)].sort()).toEqual(['q1', 'q2', 'q3'])
    const q1 = result.find(q => q.id === 'q1')
    expect(q1.options.map(o => o.id)).toEqual(['o1', 'o2', 'o3'])
  })

  it('reorders each question’s options when randomise_options is on, without touching question order', () => {
    const result = applyExamRandomization(questions, { randomise_questions: false, randomise_options: true }, 7)
    expect(result.map(q => q.id)).toEqual(['q1', 'q2', 'q3'])
    const q1 = result.find(q => q.id === 'q1')
    expect([...q1.options.map(o => o.id)].sort()).toEqual(['o1', 'o2', 'o3'])
  })

  it('never touches a question with no options array (e.g. fill_blank)', () => {
    const result = applyExamRandomization(questions, { randomise_questions: false, randomise_options: true }, 7)
    const q3 = result.find(q => q.id === 'q3')
    expect(q3.options).toBeNull()
  })

  it('is stable across two calls with the same seed (same attempt reloaded)', () => {
    const a = applyExamRandomization(questions, { randomise_questions: true, randomise_options: true }, 555)
    const b = applyExamRandomization(questions, { randomise_questions: true, randomise_options: true }, 555)
    expect(a.map(q => q.id)).toEqual(b.map(q => q.id))
    expect(a[0].options?.map(o => o.id)).toEqual(b[0].options?.map(o => o.id))
  })
})
