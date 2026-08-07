import { describe, it, expect } from 'vitest'
import { examSettingsSchema } from './exams'

const validExam = {
  title: 'CSC 301 First C.A. Test',
  course_id: '11111111-1111-4111-a111-111111111111',
  exam_type: 'ca',
  academic_session: '2024/2025',
  semester: 'first',
  duration_minutes: 45,
  pass_mark: 50,
}

describe('examSettingsSchema', () => {
  it('accepts a minimal valid exam and applies defaults', () => {
    const result = examSettingsSchema.safeParse(validExam)
    expect(result.success).toBe(true)
    expect(result.data.randomise_questions).toBe(false)
    expect(result.data.randomise_options).toBe(false)
    expect(result.data.exam_mode).toBe('remote')
    expect(result.data.proctoring_enabled).toBe(false)
    expect(result.data.show_calculator).toBe(false)
    expect(result.data.tips).toEqual([])
  })

  it('rejects a title shorter than 3 characters', () => {
    expect(examSettingsSchema.safeParse({ ...validExam, title: 'ab' }).success).toBe(false)
  })

  it('rejects a non-UUID course_id', () => {
    expect(examSettingsSchema.safeParse({ ...validExam, course_id: 'not-a-uuid' }).success).toBe(false)
  })

  it('rejects an academic_session not in YYYY/YYYY format', () => {
    expect(examSettingsSchema.safeParse({ ...validExam, academic_session: '2024-2025' }).success).toBe(false)
  })

  it('rejects a duration outside 5-300 minutes', () => {
    expect(examSettingsSchema.safeParse({ ...validExam, duration_minutes: 2 }).success).toBe(false)
    expect(examSettingsSchema.safeParse({ ...validExam, duration_minutes: 301 }).success).toBe(false)
  })

  it('rejects a pass_mark outside 0-100', () => {
    expect(examSettingsSchema.safeParse({ ...validExam, pass_mark: 150 }).success).toBe(false)
  })

  it('accepts end_at after start_at', () => {
    const result = examSettingsSchema.safeParse({
      ...validExam,
      start_at: '2025-01-01T09:00:00.000Z',
      end_at: '2025-01-01T10:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects end_at at or before start_at', () => {
    const result = examSettingsSchema.safeParse({
      ...validExam,
      start_at: '2025-01-01T10:00:00.000Z',
      end_at: '2025-01-01T09:00:00.000Z',
    })
    expect(result.success).toBe(false)
    expect(result.error.flatten().fieldErrors.end_at).toContain('End date/time must be after start date/time')
  })
})
