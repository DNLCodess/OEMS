import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/dal', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { generateAccessCode, searchEligibleStudents, addExamAccessStudent, removeExamAccessStudent } from './exams'

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

describe('searchEligibleStudents', () => {
  it('returns an error when the exam is not owned by this lecturer', async () => {
    const supabase = createMockSupabaseClient({ exams: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await searchEligibleStudents('exam-1', 'amina')

    expect(result).toEqual({ error: 'Exam not found.' })
  })

  it('returns an empty list without querying when the query is shorter than 2 characters', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await searchEligibleStudents('exam-1', 'a')

    expect(result).toEqual({ students: [] })
    expect(supabase.from).not.toHaveBeenCalledWith('users')
  })

  it('searches active students in the lecturer\'s own university and flags existing allow-list members', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      users: [{
        data: [
          { id: 'stu-1', full_name: 'Amina Bello', matric_number: 'CSC/2021/001' },
          { id: 'stu-2', full_name: 'Amina Yusuf', matric_number: 'CSC/2021/002' },
        ],
        error: null,
      }],
      exam_access: [{ data: [{ user_id: 'stu-2' }], error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await searchEligibleStudents('exam-1', 'amina')

    expect(result).toEqual({
      students: [
        { id: 'stu-1', full_name: 'Amina Bello', matric_number: 'CSC/2021/001', added: false },
        { id: 'stu-2', full_name: 'Amina Yusuf', matric_number: 'CSC/2021/002', added: true },
      ],
    })
    const usersBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'users').value
    expect(usersBuilder.eq).toHaveBeenCalledWith('university_id', 'uni-1')
    expect(usersBuilder.eq).toHaveBeenCalledWith('role', 'student')
    expect(usersBuilder.eq).toHaveBeenCalledWith('is_active', true)
    expect(usersBuilder.or).toHaveBeenCalledWith('matric_number.ilike.%amina%,full_name.ilike.%amina%')
  })

  it('strips comma and parenthesis characters from the query before building the or() filter', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      users: [{ data: [], error: null }],
      exam_access: [{ data: [], error: null }],
    })
    createClient.mockResolvedValue(supabase)

    await searchEligibleStudents('exam-1', 'ami,na(x)')

    const usersBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'users').value
    expect(usersBuilder.or).toHaveBeenCalledWith('matric_number.ilike.%amina%,full_name.ilike.%amina%')
  })

  it('prevents nested parentheses from leaving unmatched closing parens in the filter', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      users: [{ data: [], error: null }],
      exam_access: [{ data: [], error: null }],
    })
    createClient.mockResolvedValue(supabase)

    await searchEligibleStudents('exam-1', 'a(b(c)d)e')

    const usersBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'users').value
    expect(usersBuilder.or).toHaveBeenCalledWith('matric_number.ilike.%ade%,full_name.ilike.%ade%')
  })
})

describe('addExamAccessStudent', () => {
  it('returns an error when the exam is not owned by this lecturer', async () => {
    const supabase = createMockSupabaseClient({ exams: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await addExamAccessStudent('exam-1', 'stu-1')

    expect(result).toEqual({ error: 'Exam not found.' })
  })

  it('inserts an exam_access row', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      exam_access: [{ data: null, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await addExamAccessStudent('exam-1', 'stu-1')

    expect(result).toEqual({ ok: true })
    const accessBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'exam_access').value
    expect(accessBuilder.insert).toHaveBeenCalledWith({ exam_id: 'exam-1', user_id: 'stu-1' })
  })

  it('treats a duplicate add (unique violation) as success', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      exam_access: [{ data: null, error: { code: '23505', message: 'duplicate key value' } }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await addExamAccessStudent('exam-1', 'stu-1')

    expect(result).toEqual({ ok: true })
  })
})

describe('removeExamAccessStudent', () => {
  it('returns an error when the exam is not owned by this lecturer', async () => {
    const supabase = createMockSupabaseClient({ exams: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await removeExamAccessStudent('exam-1', 'stu-1')

    expect(result).toEqual({ error: 'Exam not found.' })
  })

  it('deletes the exam_access row for this exam and student', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      exam_access: [{ data: null, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await removeExamAccessStudent('exam-1', 'stu-1')

    expect(result).toEqual({ ok: true })
    const accessBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'exam_access').value
    expect(accessBuilder.eq).toHaveBeenCalledWith('exam_id', 'exam-1')
    expect(accessBuilder.eq).toHaveBeenCalledWith('user_id', 'stu-1')
  })
})
