import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { mintStudentSession } from './studentSession'

beforeEach(() => vi.clearAllMocks())

describe('mintStudentSession', () => {
  it('signs out any existing session, then verifies the generated magic link to establish a new one', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: 'tok_123' } },
      error: null,
    })
    createAdminClient.mockReturnValue(adminClient)

    const serverClient = createMockSupabaseClient()
    serverClient.auth.verifyOtp.mockResolvedValue({ data: {}, error: null })
    createClient.mockResolvedValue(serverClient)

    const result = await mintStudentSession('matric-1@uni-1.students.oems.internal')

    expect(adminClient.auth.admin.generateLink).toHaveBeenCalledWith({
      type: 'magiclink',
      email: 'matric-1@uni-1.students.oems.internal',
    })
    // signOut must run before verifyOtp — prevents session bleed on shared/kiosk machines.
    expect(serverClient.auth.signOut.mock.invocationCallOrder[0])
      .toBeLessThan(serverClient.auth.verifyOtp.mock.invocationCallOrder[0])
    expect(serverClient.auth.verifyOtp).toHaveBeenCalledWith({
      type: 'magiclink',
      token_hash: 'tok_123',
    })
    expect(result).toEqual({ ok: true })
  })

  it('returns a generic error if the link cannot be generated', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.generateLink.mockResolvedValue({ data: null, error: { message: 'boom' } })
    createAdminClient.mockReturnValue(adminClient)

    const result = await mintStudentSession('x@y.internal')

    expect(result).toEqual({ error: 'Could not start session.' })
  })

  it('returns a generic error if verifyOtp fails', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: 'tok_123' } },
      error: null,
    })
    createAdminClient.mockReturnValue(adminClient)

    const serverClient = createMockSupabaseClient()
    serverClient.auth.verifyOtp.mockResolvedValue({ data: null, error: { message: 'expired' } })
    createClient.mockResolvedValue(serverClient)

    const result = await mintStudentSession('x@y.internal')

    expect(result).toEqual({ error: 'Could not start session.' })
  })
})
