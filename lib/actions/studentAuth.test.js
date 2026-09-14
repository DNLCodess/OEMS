import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({ headers: vi.fn(async () => ({ get: () => null })) }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((p) => { throw new Error(`REDIRECT:${p}`) }),
}))
vi.mock('@/lib/security/clientIp', () => ({
  resolveClientIp: vi.fn(() => '192.168.1.11'),
  isIpAllowed: vi.fn(() => true),
}))
vi.mock('@/lib/db/repositories/verificationAttempts', () => ({
  isRateLimited: vi.fn(async () => false),
  recordFailedAttempt: vi.fn(),
  clearFailedAttempts: vi.fn(),
}))
vi.mock('@/lib/db/repositories/labIpAllowlist', () => ({
  listActiveEntries: vi.fn(async () => [{ entry: '192.168.1.11' }]),
}))
vi.mock('@/lib/db/repositories/students', () => ({
  findStudentByMatric: vi.fn(),
  findStudentByMatricAndDob: vi.fn(),
}))
vi.mock('@/lib/db/repositories/exams', () => ({
  findExamByAccessCode: vi.fn(),
  findInProgressAttempt: vi.fn(async () => null),
}))
vi.mock('@/lib/auth/session', () => ({
  createSession: vi.fn(),
  destroySession: vi.fn(),
  readStudentSession: vi.fn(),
}))
vi.mock('@/lib/db/repositories/auditLog', () => ({ recordAuthEvent: vi.fn() }))

import { resolveClientIp, isIpAllowed } from '@/lib/security/clientIp'
import { isRateLimited, recordFailedAttempt, clearFailedAttempts } from '@/lib/db/repositories/verificationAttempts'
import { listActiveEntries } from '@/lib/db/repositories/labIpAllowlist'
import { findStudentByMatric, findStudentByMatricAndDob } from '@/lib/db/repositories/students'
import { findExamByAccessCode, findInProgressAttempt } from '@/lib/db/repositories/exams'
import { createSession, destroySession, readStudentSession } from '@/lib/auth/session'
import { recordAuthEvent } from '@/lib/db/repositories/auditLog'
import { verifyExamAccess, verifyResultAccess, endStudentSession } from './studentAuth'

const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }

const LIVE_EXAM = {
  id: 'exam-1', university_id: 'uni-1', status: 'live',
  go_live_at: new Date(Date.now() - 60_000), entry_window_minutes: 10,
  access_code_revoked_at: null, enforce_ip_allowlist: true,
  title: 'Demo Exam', duration_minutes: 60,
}
const ACTIVE_STUDENT = { id: 'student-1', email: 's@pcu.edu', is_active: true, university_id: 'uni-1' }

// clearAllMocks only resets call history, not mockResolvedValue/mockReturnValue
// overrides from a previous test — so every default behavior a test might
// flip must be re-established here, every time, or it leaks across tests.
beforeEach(() => {
  vi.clearAllMocks()
  resolveClientIp.mockReturnValue('192.168.1.11')
  isIpAllowed.mockReturnValue(true)
  isRateLimited.mockResolvedValue(false)
  listActiveEntries.mockResolvedValue([{ entry: '192.168.1.11' }])
  findInProgressAttempt.mockResolvedValue(null)
})

describe('verifyExamAccess', () => {
  it('rejects a client whose IP is not on the allowlist, without charging a rate-limit attempt', async () => {
    findExamByAccessCode.mockResolvedValue(LIVE_EXAM)
    isIpAllowed.mockReturnValue(false)
    const r = await verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))
    expect(r.error).toMatch(/not an approved exam machine|approved exam machine/i)
    expect(recordFailedAttempt).not.toHaveBeenCalled()
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'exam_entry_ip_blocked' }))
    expect(createSession).not.toHaveBeenCalled()
  })

  it('fails closed when the allowlist is empty and enforcement is on', async () => {
    findExamByAccessCode.mockResolvedValue(LIVE_EXAM)
    listActiveEntries.mockResolvedValue([])
    const r = await verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))
    expect(r.error).toBeDefined()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('skips the IP check entirely when enforce_ip_allowlist is false', async () => {
    findExamByAccessCode.mockResolvedValue({ ...LIVE_EXAM, enforce_ip_allowlist: false })
    isIpAllowed.mockReturnValue(false) // would fail if checked
    findStudentByMatric.mockResolvedValue(ACTIVE_STUDENT)
    await expect(verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))).rejects.toThrow('REDIRECT:/lab/ABC123')
    expect(createSession).toHaveBeenCalled()
  })

  it('treats a revoked access code as not-found', async () => {
    findExamByAccessCode.mockResolvedValue({ ...LIVE_EXAM, access_code_revoked_at: new Date() })
    const r = await verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))
    expect(r.error).toBe('Check your details and try again.')
    expect(recordFailedAttempt).toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('rate-limits after too many failed attempts', async () => {
    isRateLimited.mockResolvedValue(true)
    const r = await verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))
    expect(r.error).toBe('Too many attempts. Please wait 15 minutes and try again.')
    expect(findExamByAccessCode).not.toHaveBeenCalled()
  })

  it('unknown access code: generic error, rate-limit charged, no IP check possible', async () => {
    findExamByAccessCode.mockResolvedValue(null)
    const r = await verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ZZZZZZ' }))
    expect(r.error).toBe('Check your details and try again.')
    expect(recordFailedAttempt).toHaveBeenCalledWith('CSC/2021/001', '192.168.1.11')
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'login_failed' }))
  })

  it('exam not live: distinct message, no rate-limit charge', async () => {
    findExamByAccessCode.mockResolvedValue({ ...LIVE_EXAM, status: 'draft' })
    const r = await verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))
    expect(r.error).toMatch(/hasn't opened yet/)
    expect(recordFailedAttempt).not.toHaveBeenCalled()
  })

  it('unknown or inactive student: generic error, rate-limit charged', async () => {
    findExamByAccessCode.mockResolvedValue(LIVE_EXAM)
    findStudentByMatric.mockResolvedValue(null)
    const r = await verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/999', access_code: 'ABC123' }))
    expect(r.error).toBe('Check your details and try again.')
    expect(recordFailedAttempt).toHaveBeenCalled()
  })

  it('entry window closed with no in-progress attempt: entry-closed error', async () => {
    findExamByAccessCode.mockResolvedValue({ ...LIVE_EXAM, go_live_at: new Date(Date.now() - 3_600_000), entry_window_minutes: 10 })
    findStudentByMatric.mockResolvedValue(ACTIVE_STUDENT)
    findInProgressAttempt.mockResolvedValue(null)
    const r = await verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))
    expect(r.error).toBe('Entry for this exam has closed. Speak to your invigilator.')
    expect(createSession).not.toHaveBeenCalled()
  })

  it('entry window closed but an in-progress attempt exists: resumes (escape hatch)', async () => {
    findExamByAccessCode.mockResolvedValue({ ...LIVE_EXAM, go_live_at: new Date(Date.now() - 3_600_000), entry_window_minutes: 10 })
    findStudentByMatric.mockResolvedValue(ACTIVE_STUDENT)
    findInProgressAttempt.mockResolvedValue({ id: 'attempt-1' })
    await expect(verifyExamAccess(undefined, fd({ matric_number: 'CSC/2021/001', access_code: 'ABC123' }))).rejects.toThrow('REDIRECT:/lab/ABC123')
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ channel: 'exam_access', verifiedExamId: 'exam-1' }))
  })

  it('happy path: mints a session, clears rate-limit history, logs in, redirects', async () => {
    findExamByAccessCode.mockResolvedValue(LIVE_EXAM)
    findStudentByMatric.mockResolvedValue(ACTIVE_STUDENT)
    await expect(verifyExamAccess(undefined, fd({ matric_number: 'csc/2021/001', access_code: 'abc123' }))).rejects.toThrow('REDIRECT:/lab/ABC123')
    expect(createSession).toHaveBeenCalledWith({ userId: 'student-1', channel: 'exam_access', verifiedExamId: 'exam-1', clientIp: '192.168.1.11' })
    expect(clearFailedAttempts).toHaveBeenCalledWith('CSC/2021/001')
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'logged_in', target_user_id: 'student-1' }))
  })
})

describe('verifyResultAccess', () => {
  it('happy path: mints a result_lookup session and redirects', async () => {
    findStudentByMatricAndDob.mockResolvedValue(ACTIVE_STUDENT)
    await expect(verifyResultAccess(undefined, fd({ matric_number: 'CSC/2021/001', date_of_birth: '2003-05-14' }))).rejects.toThrow('REDIRECT:/check-result')
    expect(createSession).toHaveBeenCalledWith({ userId: 'student-1', channel: 'result_lookup', verifiedExamId: null, clientIp: '192.168.1.11' })
  })

  it('no IP allowlist check on result lookup', async () => {
    isIpAllowed.mockReturnValue(false)
    findStudentByMatricAndDob.mockResolvedValue(ACTIVE_STUDENT)
    await expect(verifyResultAccess(undefined, fd({ matric_number: 'CSC/2021/001', date_of_birth: '2003-05-14' }))).rejects.toThrow('REDIRECT:/check-result')
    expect(createSession).toHaveBeenCalled()
  })

  it('unknown matric+DOB pair: generic error, rate-limit charged', async () => {
    findStudentByMatricAndDob.mockResolvedValue(null)
    const r = await verifyResultAccess(undefined, fd({ matric_number: 'CSC/2021/999', date_of_birth: '2003-05-14' }))
    expect(r.error).toBe('Check your details and try again.')
    expect(recordFailedAttempt).toHaveBeenCalled()
  })

  it('rate-limits after too many failed attempts', async () => {
    isRateLimited.mockResolvedValue(true)
    const r = await verifyResultAccess(undefined, fd({ matric_number: 'CSC/2021/001', date_of_birth: '2003-05-14' }))
    expect(r.error).toBe('Too many attempts. Please wait 15 minutes and try again.')
  })
})

describe('endStudentSession', () => {
  it('logs the event and destroys the session, redirecting to /lab/{code}', async () => {
    readStudentSession.mockResolvedValue({ user: { id: 'student-1', university_id: 'uni-1' }, channel: 'exam_access', verifiedExamId: 'exam-1' })
    await expect(endStudentSession('ABC123')).rejects.toThrow('REDIRECT:/lab/ABC123')
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'logged_out', target_user_id: 'student-1' }))
    expect(destroySession).toHaveBeenCalled()
  })

  it('redirects to /lab with no code given', async () => {
    readStudentSession.mockResolvedValue(null)
    await expect(endStudentSession(undefined)).rejects.toThrow('REDIRECT:/lab')
  })

  it('honors a safe returnTo of /check-result', async () => {
    readStudentSession.mockResolvedValue(null)
    await expect(endStudentSession(undefined, '/check-result')).rejects.toThrow('REDIRECT:/check-result')
  })

  it('rejects an unsafe returnTo and falls back to /lab/{code}', async () => {
    readStudentSession.mockResolvedValue(null)
    await expect(endStudentSession('ABC123', 'https://evil.example.com')).rejects.toThrow('REDIRECT:/lab/ABC123')
  })
})
