import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { mintStudentSession } from './studentSession'

beforeEach(() => vi.clearAllMocks())

function mockAdminClient({ generateLink, updateUserById } = {}) {
  const adminClient = createMockSupabaseClient()
  adminClient.auth.admin.generateLink.mockResolvedValue(
    generateLink ?? {
      data: { user: { id: 'user-1' }, properties: { hashed_token: 'tok_123' } },
      error: null,
    }
  )
  adminClient.auth.admin.updateUserById.mockResolvedValue(updateUserById ?? { data: {}, error: null })
  return adminClient
}

describe('mintStudentSession', () => {
  it('records the verification channel in app_metadata, then signs out any existing session and verifies the generated magic link', async () => {
    const adminClient = mockAdminClient()
    createAdminClient.mockReturnValue(adminClient)

    const serverClient = createMockSupabaseClient()
    serverClient.auth.verifyOtp.mockResolvedValue({ data: {}, error: null })
    createClient.mockResolvedValue(serverClient)

    const result = await mintStudentSession('matric-1@uni-1.students.oems.internal', 'exam_access')

    expect(adminClient.auth.admin.generateLink).toHaveBeenCalledWith({
      type: 'magiclink',
      email: 'matric-1@uni-1.students.oems.internal',
    })
    // app_metadata can only be set via the admin API (never the browser),
    // and must be recorded before the session is established.
    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith('user-1', {
      app_metadata: { session_channel: 'exam_access', verified_exam_id: null },
    })
    expect(adminClient.auth.admin.updateUserById.mock.invocationCallOrder[0])
      .toBeLessThan(serverClient.auth.verifyOtp.mock.invocationCallOrder[0])
    // signOut must run before verifyOtp — prevents session bleed on shared/kiosk machines.
    expect(serverClient.auth.signOut.mock.invocationCallOrder[0])
      .toBeLessThan(serverClient.auth.verifyOtp.mock.invocationCallOrder[0])
    expect(serverClient.auth.verifyOtp).toHaveBeenCalledWith({
      type: 'magiclink',
      token_hash: 'tok_123',
    })
    expect(result).toEqual({ ok: true })
  })

  it('records session_channel: result_lookup for a DOB-verified session', async () => {
    const adminClient = mockAdminClient()
    createAdminClient.mockReturnValue(adminClient)

    const serverClient = createMockSupabaseClient()
    serverClient.auth.verifyOtp.mockResolvedValue({ data: {}, error: null })
    createClient.mockResolvedValue(serverClient)

    await mintStudentSession('matric-1@uni-1.students.oems.internal', 'result_lookup')

    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith('user-1', {
      app_metadata: { session_channel: 'result_lookup', verified_exam_id: null },
    })
  })

  it('also records verified_exam_id in app_metadata when an examId is passed', async () => {
    const adminClient = mockAdminClient()
    createAdminClient.mockReturnValue(adminClient)

    const serverClient = createMockSupabaseClient()
    serverClient.auth.verifyOtp.mockResolvedValue({ data: {}, error: null })
    createClient.mockResolvedValue(serverClient)

    await mintStudentSession('matric-1@uni-1.students.oems.internal', 'exam_access', 'exam-1')

    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith('user-1', {
      app_metadata: { session_channel: 'exam_access', verified_exam_id: 'exam-1' },
    })
  })

  it('sets verified_exam_id to null (not omitted) when no examId is passed, so a stale value from a prior mint cannot linger via GoTrue\'s app_metadata merge', async () => {
    const adminClient = mockAdminClient()
    createAdminClient.mockReturnValue(adminClient)

    const serverClient = createMockSupabaseClient()
    serverClient.auth.verifyOtp.mockResolvedValue({ data: {}, error: null })
    createClient.mockResolvedValue(serverClient)

    await mintStudentSession('matric-1@uni-1.students.oems.internal', 'result_lookup')

    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith('user-1', {
      app_metadata: { session_channel: 'result_lookup', verified_exam_id: null },
    })
  })

  it('returns a generic error if the link cannot be generated', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.generateLink.mockResolvedValue({ data: null, error: { message: 'boom' } })
    createAdminClient.mockReturnValue(adminClient)

    const result = await mintStudentSession('x@y.internal', 'exam_access')

    expect(result).toEqual({ error: 'Could not start session.' })
  })

  it('returns a generic error and does not establish a session if app_metadata cannot be recorded', async () => {
    const adminClient = mockAdminClient({ updateUserById: { data: null, error: { message: 'boom' } } })
    createAdminClient.mockReturnValue(adminClient)

    const serverClient = createMockSupabaseClient()
    createClient.mockResolvedValue(serverClient)

    const result = await mintStudentSession('x@y.internal', 'exam_access')

    expect(result).toEqual({ error: 'Could not start session.' })
    expect(serverClient.auth.signOut).not.toHaveBeenCalled()
    expect(serverClient.auth.verifyOtp).not.toHaveBeenCalled()
  })

  it('returns a generic error if verifyOtp fails', async () => {
    const adminClient = mockAdminClient()
    createAdminClient.mockReturnValue(adminClient)

    const serverClient = createMockSupabaseClient()
    serverClient.auth.verifyOtp.mockResolvedValue({ data: null, error: { message: 'expired' } })
    createClient.mockResolvedValue(serverClient)

    const result = await mintStudentSession('x@y.internal', 'exam_access')

    expect(result).toEqual({ error: 'Could not start session.' })
  })
})
