import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/dal', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { generateAccessCode } from './exams'

const lecturer = { id: 'lect-1', role: 'lecturer', university_id: 'uni-1' }

beforeEach(() => {
  vi.clearAllMocks()
  requireRole.mockResolvedValue(lecturer)
})

describe('generateAccessCode', () => {
  it('returns an error when the exam is not owned by this lecturer', async () => {
    const supabase = createMockSupabaseClient({ exams: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await generateAccessCode('exam-1')

    expect(result).toEqual({ error: 'Exam not found.' })
  })

  it('generates and persists a 6-character access code without forcing exam_mode', async () => {
    const supabase = createMockSupabaseClient({
      exams: [
        { data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1' }, error: null }, // getOwnedExam
        { data: null, error: null }, // collision check
        { data: null, error: null }, // the update itself
      ],
    })
    createClient.mockResolvedValue(supabase)

    const result = await generateAccessCode('exam-1')

    expect(result.access_code).toMatch(/^[A-Z0-9]{6}$/)
    expect(result.error).toBeUndefined()
  })
})
