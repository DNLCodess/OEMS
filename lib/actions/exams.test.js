import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/dal', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { generateAccessCode, searchEligibleStudents, addExamAccessStudent, removeExamAccessStudent, bulkAddExamAccessStudents, updateExamStatus, addQuestionToExam, reorderExamQuestions } from './exams'

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

describe('addQuestionToExam', () => {
  it('returns an error when the exam is not owned by this lecturer', async () => {
    const supabase = createMockSupabaseClient({ exams: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await addQuestionToExam('exam-1', 'q-1')

    expect(result).toEqual({ error: 'Exam not found.' })
  })

  it('returns an error when the exam is live or closed', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1', status: 'live' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await addQuestionToExam('exam-1', 'q-1')

    expect(result).toEqual({ error: 'Cannot add questions to a live or closed exam.' })
  })

  it('returns an error when the question is not visible (RLS returned no row)', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1', status: 'draft' }, error: null }],
      question_bank: [{ data: null, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await addQuestionToExam('exam-1', 'q-1')

    expect(result).toEqual({ error: 'Question not found.' })
  })

  it('rejects a question from a different department that this lecturer did not create', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1', status: 'draft' }, error: null }],
      question_bank: [{
        data: {
          id: 'q-1', type: 'mcq', body: 'Q', difficulty: 'medium', course_id: 'course-1',
          created_by: 'lect-2',
          courses: { course_code: 'CSC 301', department_id: 'dept-other' },
        },
        error: null,
      }],
    })
    createClient.mockResolvedValue(supabase)
    requireRole.mockResolvedValue({ ...lecturer, department_id: 'dept-1' })

    const result = await addQuestionToExam('exam-1', 'q-1')

    expect(result).toEqual({ error: "You don't have access to this question." })
  })

  it('allows a question from the same department created by a different lecturer', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1', status: 'draft' }, error: null }],
      question_bank: [{
        data: {
          id: 'q-1', type: 'mcq', body: 'Q', difficulty: 'medium', course_id: 'course-1',
          created_by: 'lect-2',
          courses: { course_code: 'CSC 301', department_id: 'dept-1' },
        },
        error: null,
      }],
      exam_questions: [
        { data: [], error: null },
        { data: { id: 'eq-1', order_index: 0, marks: 1, question_id: 'q-1' }, error: null },
      ],
    })
    createClient.mockResolvedValue(supabase)
    requireRole.mockResolvedValue({ ...lecturer, department_id: 'dept-1' })

    const result = await addQuestionToExam('exam-1', 'q-1')

    expect(result.error).toBeUndefined()
    expect(result.examQuestion.id).toBe('eq-1')
  })

  it('allows a lecturer\'s own question regardless of department', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1', status: 'draft' }, error: null }],
      question_bank: [{
        data: {
          id: 'q-1', type: 'mcq', body: 'Q', difficulty: 'medium', course_id: 'course-1',
          created_by: 'lect-1',
          courses: { course_code: 'CSC 301', department_id: 'dept-other' },
        },
        error: null,
      }],
      exam_questions: [
        { data: [], error: null },
        { data: { id: 'eq-1', order_index: 0, marks: 1, question_id: 'q-1' }, error: null },
      ],
    })
    createClient.mockResolvedValue(supabase)
    requireRole.mockResolvedValue({ ...lecturer, department_id: 'dept-1' })

    const result = await addQuestionToExam('exam-1', 'q-1')

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

  it('returns an error when the exam is live', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'live', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await addExamAccessStudent('exam-1', 'stu-1')

    expect(result).toEqual({ error: 'Exam access cannot be changed once the exam has started.' })
    expect(supabase.from).not.toHaveBeenCalledWith('exam_access')
  })

  it('returns an error when the exam is closed', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'closed', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await addExamAccessStudent('exam-1', 'stu-1')

    expect(result).toEqual({ error: 'Exam access cannot be changed once the exam has started.' })
    expect(supabase.from).not.toHaveBeenCalledWith('exam_access')
  })

  it('returns an error when the student is not an active student in this university', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'draft', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      users: [{ data: null, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await addExamAccessStudent('exam-1', 'stu-1')

    expect(result).toEqual({ error: 'Student not found.' })
    expect(supabase.from).not.toHaveBeenCalledWith('exam_access')
  })

  it('inserts an exam_access row', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'draft', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      users: [{ data: { id: 'stu-1' }, error: null }],
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
      exams: [{ data: { id: 'exam-1', status: 'draft', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      users: [{ data: { id: 'stu-1' }, error: null }],
      exam_access: [{ data: null, error: { code: '23505', message: 'duplicate key value' } }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await addExamAccessStudent('exam-1', 'stu-1')

    expect(result).toEqual({ ok: true })
  })
})

describe('bulkAddExamAccessStudents', () => {
  it('returns an error when the exam is not owned by this lecturer', async () => {
    const supabase = createMockSupabaseClient({ exams: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await bulkAddExamAccessStudents('exam-1', ['CSC/2021/001'])

    expect(result).toEqual({ error: 'Exam not found.' })
  })

  it('returns an error when the exam is live', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'live', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await bulkAddExamAccessStudents('exam-1', ['CSC/2021/001'])

    expect(result).toEqual({ error: 'Exam access cannot be changed once the exam has started.' })
    expect(supabase.from).not.toHaveBeenCalledWith('users')
  })

  it('returns an error when no matric numbers are given', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'draft', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await bulkAddExamAccessStudents('exam-1', ['', '   '])

    expect(result).toEqual({ error: 'No matric numbers to add.' })
    expect(supabase.from).not.toHaveBeenCalledWith('users')
  })

  it('returns an error when more than 1000 matric numbers are given', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'draft', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const tooMany = Array.from({ length: 1001 }, (_, i) => `CSC/2021/${i}`)
    const result = await bulkAddExamAccessStudents('exam-1', tooMany)

    expect(result).toEqual({ error: 'Too many at once — split into smaller batches.' })
    expect(supabase.from).not.toHaveBeenCalledWith('users')
  })

  it('normalizes case/whitespace and dedupes before matching', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'draft', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      users: [{ data: [{ id: 'stu-1', full_name: 'Amina Bello', matric_number: 'CSC/2021/001' }], error: null }],
      exam_access: [
        { data: [], error: null }, // existing allow-list — empty, so stu-1 gets inserted
        { data: null, error: null }, // the insert itself
      ],
    })
    createClient.mockResolvedValue(supabase)

    await bulkAddExamAccessStudents('exam-1', ['csc/2021/001', ' CSC/2021/001 '])

    const usersBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'users').value
    expect(usersBuilder.in).toHaveBeenCalledWith('matric_number', ['CSC/2021/001'])
    expect(usersBuilder.eq).toHaveBeenCalledWith('university_id', 'uni-1')
    expect(usersBuilder.eq).toHaveBeenCalledWith('role', 'student')
    expect(usersBuilder.eq).toHaveBeenCalledWith('is_active', true)
  })

  it('returns notFound and skips the exam_access query entirely when nothing matches', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'draft', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      users: [{ data: [], error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await bulkAddExamAccessStudents('exam-1', ['CSC/2021/999'])

    expect(result).toEqual({ added: [], alreadyAddedCount: 0, notFound: ['CSC/2021/999'] })
    expect(supabase.from).not.toHaveBeenCalledWith('exam_access')
  })

  it('inserts only students not already on the allow-list, and reports alreadyAddedCount', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'draft', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      users: [{
        data: [
          { id: 'stu-1', full_name: 'Amina Bello', matric_number: 'CSC/2021/001' },
          { id: 'stu-2', full_name: 'Femi Ade',    matric_number: 'CSC/2021/002' },
        ],
        error: null,
      }],
      exam_access: [
        { data: [{ user_id: 'stu-1' }], error: null }, // existing allow-list — stu-1 already added
        { data: null, error: null },                    // the insert itself
      ],
    })
    createClient.mockResolvedValue(supabase)

    const result = await bulkAddExamAccessStudents('exam-1', ['CSC/2021/001', 'CSC/2021/002'])

    expect(result).toEqual({
      added: [{ id: 'stu-2', full_name: 'Femi Ade', matric_number: 'CSC/2021/002' }],
      alreadyAddedCount: 1,
      notFound: [],
    })
    const accessBuilders = supabase.from.mock.results
      .filter((_, i) => supabase.from.mock.calls[i][0] === 'exam_access')
      .map(r => r.value)
    const insertBuilder = accessBuilders.find(b => b.insert.mock.calls.length > 0)
    expect(insertBuilder.insert).toHaveBeenCalledWith([{ exam_id: 'exam-1', user_id: 'stu-2' }])
  })

  it('skips the insert call entirely when every matched student is already on the allow-list', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'draft', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      users: [{ data: [{ id: 'stu-1', full_name: 'Amina Bello', matric_number: 'CSC/2021/001' }], error: null }],
      exam_access: [{ data: [{ user_id: 'stu-1' }], error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await bulkAddExamAccessStudents('exam-1', ['CSC/2021/001'])

    expect(result).toEqual({ added: [], alreadyAddedCount: 1, notFound: [] })
  })
})

describe('removeExamAccessStudent', () => {
  it('returns an error when the exam is not owned by this lecturer', async () => {
    const supabase = createMockSupabaseClient({ exams: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await removeExamAccessStudent('exam-1', 'stu-1')

    expect(result).toEqual({ error: 'Exam not found.' })
  })

  it('returns an error when the exam is live', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'live', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await removeExamAccessStudent('exam-1', 'stu-1')

    expect(result).toEqual({ error: 'Exam access cannot be changed once the exam has started.' })
    expect(supabase.from).not.toHaveBeenCalledWith('exam_access')
  })

  it('deletes the exam_access row for this exam and student', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'draft', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
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

describe('updateExamStatus', () => {
  it('stamps go_live_at when transitioning to live', async () => {
    const supabase = createMockSupabaseClient({
      exams: [
        { data: { id: 'exam-1', status: 'scheduled', created_by: 'lect-1', university_id: 'uni-1' }, error: null }, // getOwnedExam
        { data: null, error: null }, // the update itself
      ],
      exam_questions: [
        { data: { id: 1 }, count: 3, error: null }, // question count guard
      ],
    })
    createClient.mockResolvedValue(supabase)

    await updateExamStatus('exam-1', 'live')

    // Get the builder that has update calls on it
    const updateBuilder = supabase.from.mock.results
      .filter((_, i) => supabase.from.mock.calls[i][0] === 'exams')
      .map(r => r.value)
      .find(builder => builder.update.mock.calls.length > 0)
    const updatePayload = updateBuilder.update.mock.calls[0][0]
    expect(updatePayload.status).toBe('live')
    expect(updatePayload.go_live_at).toEqual(expect.any(String))
    expect(new Date(updatePayload.go_live_at).toString()).not.toBe('Invalid Date')
  })

  it('does not set go_live_at when transitioning to a non-live status', async () => {
    const supabase = createMockSupabaseClient({
      exams: [
        { data: { id: 'exam-1', status: 'live', created_by: 'lect-1', university_id: 'uni-1' }, error: null },
        { data: null, error: null },
      ],
    })
    createClient.mockResolvedValue(supabase)

    await updateExamStatus('exam-1', 'closed')

    const updateBuilder = supabase.from.mock.results
      .filter((_, i) => supabase.from.mock.calls[i][0] === 'exams')
      .map(r => r.value)
      .find(builder => builder.update.mock.calls.length > 0)
    const updatePayload = updateBuilder.update.mock.calls[0][0]
    expect(updatePayload.status).toBe('closed')
    expect(updatePayload.go_live_at).toBeUndefined()
  })
})

describe('reorderExamQuestions', () => {
  it('returns an error when the exam is not owned by this lecturer', async () => {
    const supabase = createMockSupabaseClient({ exams: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await reorderExamQuestions('exam-1', ['q-1', 'q-2'])

    expect(result).toEqual({ error: 'Exam not found.' })
  })

  it('rejects reordering on a live exam', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1', status: 'live' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await reorderExamQuestions('exam-1', ['q-1', 'q-2'])

    expect(result).toEqual({ error: 'Cannot reorder questions on a live or closed exam.' })
    expect(supabase.from).not.toHaveBeenCalledWith('exam_questions')
  })

  it('rejects reordering on a closed exam', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1', status: 'closed' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await reorderExamQuestions('exam-1', ['q-1', 'q-2'])

    expect(result).toEqual({ error: 'Cannot reorder questions on a live or closed exam.' })
  })

  it('writes every question order in a single upsert call, keyed on (exam_id, question_id)', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1', status: 'draft' }, error: null }],
      exam_questions: [
        { data: [{ question_id: 'q-1' }, { question_id: 'q-2' }, { question_id: 'q-3' }], error: null },
        { data: null, error: null },
      ],
    })
    createClient.mockResolvedValue(supabase)

    const result = await reorderExamQuestions('exam-1', ['q-2', 'q-1', 'q-3'])

    expect(result).toEqual({ ok: true })
    const builders = supabase.from.mock.results
      .filter((_, i) => supabase.from.mock.calls[i][0] === 'exam_questions')
      .map(r => r.value)
    expect(builders[1].upsert).toHaveBeenCalledTimes(1)
    expect(builders[1].upsert).toHaveBeenCalledWith(
      [
        { exam_id: 'exam-1', question_id: 'q-2', order_index: 0 },
        { exam_id: 'exam-1', question_id: 'q-1', order_index: 1 },
        { exam_id: 'exam-1', question_id: 'q-3', order_index: 2 },
      ],
      { onConflict: 'exam_id,question_id' }
    )
  })

  it('drops a question_id not already associated with this exam instead of upserting it, so reordering can never create a new association', async () => {
    // Only q-1 and q-2 are genuinely part of exam-1. q-9 is a foreign id —
    // e.g. tampered client payload, or another exam's question — and must
    // never reach the upsert, since upsert() can INSERT as well as update,
    // and inserting it here would associate an unvalidated question with
    // this exam, bypassing addQuestionToExam's own ownership checks.
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1', status: 'draft' }, error: null }],
      exam_questions: [
        { data: [{ question_id: 'q-1' }, { question_id: 'q-2' }], error: null },
        { data: null, error: null },
      ],
    })
    createClient.mockResolvedValue(supabase)

    const result = await reorderExamQuestions('exam-1', ['q-9', 'q-1', 'q-2'])

    expect(result).toEqual({ ok: true })
    const builders = supabase.from.mock.results
      .filter((_, i) => supabase.from.mock.calls[i][0] === 'exam_questions')
      .map(r => r.value)
    expect(builders[1].upsert).toHaveBeenCalledWith(
      [
        { exam_id: 'exam-1', question_id: 'q-1', order_index: 0 },
        { exam_id: 'exam-1', question_id: 'q-2', order_index: 1 },
      ],
      { onConflict: 'exam_id,question_id' }
    )
  })

  it('skips the upsert call entirely and still succeeds when every submitted id is foreign to this exam', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1', status: 'draft' }, error: null }],
      exam_questions: [
        { data: [{ question_id: 'q-1' }], error: null },
      ],
    })
    createClient.mockResolvedValue(supabase)

    const result = await reorderExamQuestions('exam-1', ['q-9'])

    expect(result).toEqual({ ok: true })
    const builders = supabase.from.mock.results
      .filter((_, i) => supabase.from.mock.calls[i][0] === 'exam_questions')
      .map(r => r.value)
    expect(builders[0].upsert).not.toHaveBeenCalled()
  })

  it('returns a generic error when the upsert fails', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', created_by: 'lect-1', university_id: 'uni-1', status: 'draft' }, error: null }],
      exam_questions: [
        { data: [{ question_id: 'q-1' }], error: null },
        { data: null, error: { message: 'connection reset' } },
      ],
    })
    createClient.mockResolvedValue(supabase)

    const result = await reorderExamQuestions('exam-1', ['q-1'])

    expect(result).toEqual({ error: 'Failed to save question order.' })
  })
})
