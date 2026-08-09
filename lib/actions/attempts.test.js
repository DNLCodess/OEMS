import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/dal', () => ({
  requireRole: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { startExam, saveAnswer, submitExam } from './attempts'

const student = { id: 'stu-1', role: 'student', university_id: 'uni-1' }

const EXAM_ACCESS_REQUIRED = {
  error: 'Please enter this exam using your matric number and access code.',
}

// `session_channel` is read from the auth user's app_metadata via a live
// getUser() call — never from a client-writable cookie — so these helpers
// build the getUser() response shape the real code destructures.
function authUserWith(sessionChannel, examId) {
  return { data: { user: { app_metadata: { session_channel: sessionChannel, verified_exam_id: examId } } } }
}
const NO_METADATA = { data: { user: { app_metadata: undefined } } }

beforeEach(() => {
  vi.clearAllMocks()
  requireRole.mockResolvedValue(student)
})

describe('startExam', () => {
  it('proceeds normally for an exam-access-channel session (happy path preserved)', async () => {
    const supabase = createMockSupabaseClient({
      exams:    [{ data: { id: 'exam-1', status: 'live', university_id: 'uni-1' }, error: null }],
      attempts: [
        { data: null, error: null },                 // no existing attempt
        { data: { id: 'attempt-1' }, error: null },   // insert → select → single
      ],
    })
    supabase.auth.getUser.mockResolvedValue(authUserWith('exam_access', 'exam-1'))
    createClient.mockResolvedValue(supabase)

    const result = await startExam('exam-1')

    expect(result).toEqual({ attemptId: 'attempt-1' })
  })

  it('rejects a result-lookup-channel session without touching the attempts table', async () => {
    const supabase = createMockSupabaseClient()
    supabase.auth.getUser.mockResolvedValue(authUserWith('result_lookup'))
    createClient.mockResolvedValue(supabase)

    const result = await startExam('exam-1')

    expect(result).toEqual(EXAM_ACCESS_REQUIRED)
    expect(supabase.from).not.toHaveBeenCalledWith('attempts')
    expect(supabase.from).not.toHaveBeenCalledWith('exams')
  })

  it('rejects a session with missing/undefined app_metadata (fails closed, not open)', async () => {
    const supabase = createMockSupabaseClient()
    supabase.auth.getUser.mockResolvedValue(NO_METADATA)
    createClient.mockResolvedValue(supabase)

    const result = await startExam('exam-1')

    expect(result).toEqual(EXAM_ACCESS_REQUIRED)
    expect(supabase.from).not.toHaveBeenCalledWith('attempts')
  })

  it('rejects an exam-access session verified for a DIFFERENT exam, without touching the attempts table', async () => {
    const supabase = createMockSupabaseClient()
    supabase.auth.getUser.mockResolvedValue(authUserWith('exam_access', 'exam-2'))
    createClient.mockResolvedValue(supabase)

    const result = await startExam('exam-1')

    expect(result).toEqual(EXAM_ACCESS_REQUIRED)
    expect(supabase.from).not.toHaveBeenCalledWith('attempts')
    expect(supabase.from).not.toHaveBeenCalledWith('exams')
  })
})

describe('saveAnswer', () => {
  it('proceeds normally for an exam-access-channel session (happy path preserved)', async () => {
    const startedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString() // 30 min ago
    const supabase = createMockSupabaseClient({
      attempts:  [{ data: { id: 'attempt-1', status: 'in_progress', started_at: startedAt, exams: { duration_minutes: 60 } }, error: null }],
      responses: [{ data: null, error: null }],
    })
    supabase.auth.getUser.mockResolvedValue(authUserWith('exam_access'))
    createClient.mockResolvedValue(supabase)

    const result = await saveAnswer('attempt-1', 'q1', 'a')

    expect(result).toEqual({ ok: true })
  })

  it('rejects a save once the attempt is past its deadline plus grace period', async () => {
    const startedAt = new Date(Date.now() - 61 * 60 * 1000).toISOString() // 61 min ago
    const supabase = createMockSupabaseClient({
      attempts: [
        { data: { id: 'attempt-1', status: 'in_progress', started_at: startedAt, exams: { duration_minutes: 60 } }, error: null },
      ],
    })
    supabase.auth.getUser.mockResolvedValue(authUserWith('exam_access', 'exam-1'))
    createClient.mockResolvedValue(supabase)

    const result = await saveAnswer('attempt-1', 'q1', 'a')

    expect(result).toEqual({ error: 'Time is up — submitting your exam…', timeExpired: true })
    expect(supabase.from).not.toHaveBeenCalledWith('responses')
  })

  it('still allows a save within the grace period just past the deadline', async () => {
    const startedAt = new Date(Date.now() - 60 * 60 * 1000 - 30 * 1000).toISOString() // 60 min 30s ago — inside the 60s grace
    const supabase = createMockSupabaseClient({
      attempts: [
        { data: { id: 'attempt-1', status: 'in_progress', started_at: startedAt, exams: { duration_minutes: 60 } }, error: null },
      ],
      responses: [{ data: null, error: null }],
    })
    supabase.auth.getUser.mockResolvedValue(authUserWith('exam_access', 'exam-1'))
    createClient.mockResolvedValue(supabase)

    const result = await saveAnswer('attempt-1', 'q1', 'a')

    expect(result).toEqual({ ok: true })
  })

  it('rejects a result-lookup-channel session without touching the responses table', async () => {
    const supabase = createMockSupabaseClient()
    supabase.auth.getUser.mockResolvedValue(authUserWith('result_lookup'))
    createClient.mockResolvedValue(supabase)

    const result = await saveAnswer('attempt-1', 'q1', 'a')

    expect(result).toEqual(EXAM_ACCESS_REQUIRED)
    expect(supabase.from).not.toHaveBeenCalledWith('responses')
    expect(supabase.from).not.toHaveBeenCalledWith('attempts')
  })

  it('rejects a session with missing/undefined app_metadata (fails closed, not open)', async () => {
    const supabase = createMockSupabaseClient()
    supabase.auth.getUser.mockResolvedValue(NO_METADATA)
    createClient.mockResolvedValue(supabase)

    const result = await saveAnswer('attempt-1', 'q1', 'a')

    expect(result).toEqual(EXAM_ACCESS_REQUIRED)
    expect(supabase.from).not.toHaveBeenCalledWith('responses')
  })
})

describe('submitExam', () => {
  function setupHappyPath() {
    const supabase = createMockSupabaseClient({
      attempts: [
        { data: { id: 'attempt-1', exam_id: 'exam-1', status: 'in_progress', student_id: 'stu-1' }, error: null },
        { data: null, error: null }, // update → submitted
      ],
      exam_questions: [{
        data: [{ question_id: 'q1', marks: 10, question_bank: { type: 'mcq', correct_answer: 'a' } }],
        error: null,
      }],
      responses: [
        { data: [{ question_id: 'q1', student_answer: 'a' }], error: null }, // saved responses
        { data: null, error: null }, // upsert graded responses
      ],
      exams: [{ data: { pass_mark: 50 }, error: null }],
    })
    supabase.auth.getUser.mockResolvedValue(authUserWith('exam_access'))
    createClient.mockResolvedValue(supabase)

    const adminClient = createMockSupabaseClient({
      results: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    return { supabase, adminClient }
  }

  it('proceeds normally for an exam-access-channel session (happy path preserved)', async () => {
    setupHappyPath()

    const result = await submitExam('attempt-1')

    expect(result).toEqual({ ok: true, examId: 'exam-1' })
  })

  it('inserts the result row through the admin client, not the student-session client', async () => {
    const { supabase, adminClient } = setupHappyPath()

    await submitExam('attempt-1')

    // The student-session client must never touch `results` — there is no
    // RLS policy letting a student INSERT into it.
    expect(supabase.from).not.toHaveBeenCalledWith('results')

    const resultsBuilder = adminClient.from.mock.results.find(
      (r, i) => adminClient.from.mock.calls[i][0] === 'results'
    ).value
    expect(resultsBuilder.insert).toHaveBeenCalledTimes(1)
  })

  it('sets released_at immediately when inserting the result row', async () => {
    const { adminClient } = setupHappyPath()

    await submitExam('attempt-1')

    const resultsBuilder = adminClient.from.mock.results.find(
      (r, i) => adminClient.from.mock.calls[i][0] === 'results'
    ).value
    const insertedRow = resultsBuilder.insert.mock.calls[0][0]
    expect(insertedRow.released_at).toEqual(expect.any(String))
    expect(new Date(insertedRow.released_at).toString()).not.toBe('Invalid Date')
  })

  it('rejects a result-lookup-channel session without touching the attempts/responses/results tables', async () => {
    const supabase = createMockSupabaseClient()
    supabase.auth.getUser.mockResolvedValue(authUserWith('result_lookup'))
    createClient.mockResolvedValue(supabase)

    const result = await submitExam('attempt-1')

    expect(result).toEqual(EXAM_ACCESS_REQUIRED)
    expect(supabase.from).not.toHaveBeenCalledWith('attempts')
    expect(supabase.from).not.toHaveBeenCalledWith('responses')
    expect(supabase.from).not.toHaveBeenCalledWith('results')
  })

  it('rejects a session with missing/undefined app_metadata (fails closed, not open)', async () => {
    const supabase = createMockSupabaseClient()
    supabase.auth.getUser.mockResolvedValue(NO_METADATA)
    createClient.mockResolvedValue(supabase)

    const result = await submitExam('attempt-1')

    expect(result).toEqual(EXAM_ACCESS_REQUIRED)
    expect(supabase.from).not.toHaveBeenCalledWith('attempts')
  })
})
