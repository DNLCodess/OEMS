import { describe, it, expect } from 'vitest'
import { questionSchema } from './questions'

const courseId = '11111111-1111-4111-a111-111111111111'

describe('questionSchema', () => {
  it('accepts a valid MCQ question', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'mcq',
      difficulty: 'easy',
      body: '<p>What is 2 + 2?</p>',
      options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }],
      correct_answer: 'b',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an MCQ with fewer than 2 options', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'mcq',
      difficulty: 'easy',
      body: '<p>What is 2 + 2?</p>',
      options: [{ id: 'a', text: '4' }],
      correct_answer: 'a',
    })
    expect(result.success).toBe(false)
    expect(result.error.issues.some(i => i.path.join('.') === 'options')).toBe(true)
  })

  it('rejects an MCQ with no correct_answer selected', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'mcq',
      difficulty: 'easy',
      body: '<p>What is 2 + 2?</p>',
      options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }],
    })
    expect(result.success).toBe(false)
    expect(result.error.issues.some(i => i.path.join('.') === 'correct_answer')).toBe(true)
  })

  it('rejects a multi_select answer that is not a non-empty array', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'multi_select',
      difficulty: 'medium',
      body: '<p>Select all prime numbers.</p>',
      options: [{ id: 'a', text: '2' }, { id: 'b', text: '4' }],
      correct_answer: 'a',
    })
    expect(result.success).toBe(false)
    expect(result.error.issues.some(i => i.path.join('.') === 'correct_answer')).toBe(true)
  })

  it('accepts a valid multi_select question', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'multi_select',
      difficulty: 'medium',
      body: '<p>Select all prime numbers.</p>',
      options: [{ id: 'a', text: '2' }, { id: 'b', text: '4' }],
      correct_answer: ['a'],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a true_false question with no correct_answer', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'true_false',
      difficulty: 'easy',
      body: '<p>The sky is blue.</p>',
      options: [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a fill_blank question with an empty correct_answer', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'fill_blank',
      difficulty: 'medium',
      body: '<p>The capital of Nigeria is ___.</p>',
      correct_answer: '   ',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a fill_blank question with a non-empty correct_answer', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'fill_blank',
      difficulty: 'medium',
      body: '<p>The capital of Nigeria is ___.</p>',
      correct_answer: 'Abuja',
    })
    expect(result.success).toBe(true)
  })

  // The form binds `tags` to a plain text input (a comma-separated string) —
  // it must stay a string through to the server, where parsePayload does the
  // splitting. An array here would mean the client transformed it too early,
  // which fails this same schema on the server's re-validation.
  it('rejects tags as an array — it must stay the raw comma-separated string the form produces', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'mcq',
      difficulty: 'easy',
      body: '<p>What is 2 + 2?</p>',
      options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }],
      correct_answer: 'b',
      tags: ['algebra', 'basics'],
    })
    expect(result.success).toBe(false)
  })

  it('accepts tags as a comma-separated string', () => {
    const result = questionSchema.safeParse({
      course_id: courseId,
      type: 'mcq',
      difficulty: 'easy',
      body: '<p>What is 2 + 2?</p>',
      options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }],
      correct_answer: 'b',
      tags: 'algebra, basics',
    })
    expect(result.success).toBe(true)
  })
})
