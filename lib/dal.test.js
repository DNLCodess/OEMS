import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path) => { throw new Error(`REDIRECT:${path}`) }),
}))

import { createClient } from '@/lib/supabase/server'
import { getAuthUser, requireRole, roleHome } from './dal'

function mockClientWithProfile(profile, { authError = null, profileError = null } = {}) {
  const client = createMockSupabaseClient({
    users: [{ data: profileError ? null : profile, error: profileError }],
  })
  client.auth.getUser.mockResolvedValue({
    data: { user: authError ? null : { id: profile?.id ?? 'u1' } },
    error: authError,
  })
  return client
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getAuthUser', () => {
  it('redirects to /login when there is no session', async () => {
    createClient.mockResolvedValue(mockClientWithProfile(null, { authError: new Error('no session') }))

    await expect(getAuthUser()).rejects.toThrow(/^REDIRECT:\/login$/)
  })

  it('redirects to /login when the profile lookup fails', async () => {
    createClient.mockResolvedValue(mockClientWithProfile(null, { profileError: new Error('not found') }))

    await expect(getAuthUser()).rejects.toThrow(/^REDIRECT:\/login$/)
  })

  it('redirects to /login?error=account_suspended when the account is inactive', async () => {
    const profile = { id: 'u1', role: 'student', is_active: false }
    createClient.mockResolvedValue(mockClientWithProfile(profile))

    await expect(getAuthUser()).rejects.toThrow('REDIRECT:/login?error=account_suspended')
  })

  it('returns the profile when the session and account are valid', async () => {
    const profile = { id: 'u1', role: 'student', is_active: true }
    createClient.mockResolvedValue(mockClientWithProfile(profile))

    await expect(getAuthUser()).resolves.toEqual(profile)
  })
})

describe('requireRole', () => {
  it('returns the user when their role is allowed', async () => {
    const profile = { id: 'u1', role: 'lecturer', is_active: true }
    createClient.mockResolvedValue(mockClientWithProfile(profile))

    await expect(requireRole('lecturer', 'school_admin')).resolves.toEqual(profile)
  })

  it("redirects to the user's role home when their role is not allowed", async () => {
    const profile = { id: 'u1', role: 'student', is_active: true }
    createClient.mockResolvedValue(mockClientWithProfile(profile))

    await expect(requireRole('lecturer')).rejects.toThrow('REDIRECT:/student/dashboard')
  })
})

describe('roleHome', () => {
  it('maps each known role to its dashboard route', () => {
    expect(roleHome('super_admin')).toBe('/super-admin/dashboard')
    expect(roleHome('school_admin')).toBe('/admin/dashboard')
    expect(roleHome('lecturer')).toBe('/lecturer/dashboard')
    expect(roleHome('student')).toBe('/student/dashboard')
  })

  it('falls back to /login for an unknown role', () => {
    expect(roleHome('nonexistent')).toBe('/login')
  })
})
