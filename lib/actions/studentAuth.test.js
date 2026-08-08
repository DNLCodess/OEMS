import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/studentSession', () => ({ mintStudentSession: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('REDIRECT') }) }))
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Map([['x-forwarded-for', '203.0.113.1']])),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { mintStudentSession } from '@/lib/supabase/studentSession'
import { redirect } from 'next/navigation'
import { verifyExamAccess, verifyResultAccess } from './studentAuth'

function formData(fields) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

const GENERIC = { error: 'Check your details and try again.' }
const RATE_LIMITED = { error: 'Too many attempts. Please wait 15 minutes and try again.' }

beforeEach(() => vi.clearAllMocks())

describe('verifyExamAccess', () => {
  it('rejects an unknown access code without leaking which field was wrong', async () => {
    // Two verification_attempts responses queued: one for the rate-limit
    // count check, one for the recordFailedAttempt insert that follows.
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      exams: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))

    expect(result).toEqual(GENERIC)
    expect(mintStudentSession).not.toHaveBeenCalled()
  })

  it('mints a session and redirects when matric number and access code both match a live exam', async () => {
    // A third verification_attempts response is queued for the
    // clearFailedAttempts delete that runs right before the redirect.
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      exams: [{ data: { id: 'exam-1', university_id: 'uni-1', status: 'live' }, error: null }],
      users: [{ data: { id: 'stu-1', email: 'csc2021001@uni-1.students.oems.internal', is_active: true }, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)
    mintStudentSession.mockResolvedValue({ ok: true })

    await expect(
      verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'abc123' }))
    ).rejects.toThrow('REDIRECT')

    expect(mintStudentSession).toHaveBeenCalledWith('csc2021001@uni-1.students.oems.internal', 'exam_access')
    expect(redirect).toHaveBeenCalledWith('/lab/ABC123')
  })

  it('clears the matric number attempt history on a successful verification', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      exams: [{ data: { id: 'exam-1', university_id: 'uni-1', status: 'live' }, error: null }],
      users: [{ data: { id: 'stu-1', email: 'csc2021001@uni-1.students.oems.internal', is_active: true }, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)
    mintStudentSession.mockResolvedValue({ ok: true })

    await expect(
      verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'abc123' }))
    ).rejects.toThrow('REDIRECT')

    const deleteQuery = adminClient.from.mock.results[3].value
    expect(adminClient.from).toHaveBeenNthCalledWith(4, 'verification_attempts')
    expect(deleteQuery.delete).toHaveBeenCalled()
    expect(deleteQuery.eq).toHaveBeenCalledWith('matric_number', 'CSC/2021/001')
  })

  it('blocks after too many failed attempts for the same matric_number, with a distinct lockout message', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 5 }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))

    expect(result).toEqual(RATE_LIMITED)
    expect(adminClient.from).not.toHaveBeenCalledWith('exams')
  })

  it('normalizes a lower-case matric number to uppercase before matching, so casing never causes a false rejection', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      exams: [{ data: { id: 'exam-1', university_id: 'uni-1', status: 'live' }, error: null }],
      users: [{ data: { id: 'stu-1', email: 'csc2021001@uni-1.students.oems.internal', is_active: true }, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)
    mintStudentSession.mockResolvedValue({ ok: true })

    await expect(
      verifyExamAccess(undefined, formData({ matric_number: 'csc/2021/001', access_code: 'abc123' }))
    ).rejects.toThrow('REDIRECT')

    const usersQuery = adminClient.from.mock.results[2].value
    expect(usersQuery.eq).toHaveBeenCalledWith('matric_number', 'CSC/2021/001')
  })

  it('rate-limits by matric_number alone — the lookup never filters by ip, so a spoofed IP cannot reset the bucket', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 5 }],
    })
    createAdminClient.mockReturnValue(adminClient)

    await verifyExamAccess(undefined, formData({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))

    expect(adminClient.from).toHaveBeenCalledWith('verification_attempts')
    const rateLimitQuery = adminClient.from.mock.results[0].value

    expect(rateLimitQuery.eq).toHaveBeenCalledWith('matric_number', 'CSC/2021/001')
    expect(rateLimitQuery.eq).not.toHaveBeenCalledWith('ip', expect.anything())
    expect(rateLimitQuery.gte).toHaveBeenCalledWith('created_at', expect.any(String))
  })
})

describe('verifyResultAccess', () => {
  it('rejects when matric number + date of birth match zero students', async () => {
    // Two verification_attempts responses queued: rate-limit check + the
    // recordFailedAttempt insert that follows a zero-match result.
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      users: [{ data: [], error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyResultAccess(undefined, formData({ matric_number: 'CSC/2021/001', date_of_birth: '2003-04-12' }))

    expect(result).toEqual(GENERIC)
  })

  it('rejects when matric number + date of birth match more than one student (cross-university collision)', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      users: [{ data: [{ id: 'a', email: 'a@x', is_active: true }, { id: 'b', email: 'b@x', is_active: true }], error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyResultAccess(undefined, formData({ matric_number: 'CSC/2021/001', date_of_birth: '2003-04-12' }))

    expect(result).toEqual(GENERIC)
    expect(mintStudentSession).not.toHaveBeenCalled()
  })

  it('mints a session and redirects to /student/results on exactly one match', async () => {
    // A second verification_attempts response is queued for the
    // clearFailedAttempts delete that runs right before the redirect.
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      users: [{ data: [{ id: 'a', email: 'a@uni-1.students.oems.internal', is_active: true }], error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)
    mintStudentSession.mockResolvedValue({ ok: true })

    await expect(
      verifyResultAccess(undefined, formData({ matric_number: 'CSC/2021/001', date_of_birth: '2003-04-12' }))
    ).rejects.toThrow('REDIRECT')

    expect(mintStudentSession).toHaveBeenCalledWith('a@uni-1.students.oems.internal', 'result_lookup')
    expect(redirect).toHaveBeenCalledWith('/student/results')
  })

  it('clears the matric number attempt history on a successful verification', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      users: [{ data: [{ id: 'a', email: 'a@uni-1.students.oems.internal', is_active: true }], error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)
    mintStudentSession.mockResolvedValue({ ok: true })

    await expect(
      verifyResultAccess(undefined, formData({ matric_number: 'CSC/2021/001', date_of_birth: '2003-04-12' }))
    ).rejects.toThrow('REDIRECT')

    const deleteQuery = adminClient.from.mock.results[2].value
    expect(adminClient.from).toHaveBeenNthCalledWith(3, 'verification_attempts')
    expect(deleteQuery.delete).toHaveBeenCalled()
    expect(deleteQuery.eq).toHaveBeenCalledWith('matric_number', 'CSC/2021/001')
  })

  it('blocks after too many failed attempts, with a distinct lockout message', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 5 }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyResultAccess(undefined, formData({ matric_number: 'CSC/2021/001', date_of_birth: '2003-04-12' }))

    expect(result).toEqual(RATE_LIMITED)
    expect(adminClient.from).not.toHaveBeenCalledWith('users')
  })
})
