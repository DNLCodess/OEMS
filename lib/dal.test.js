import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ readSessionUser: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path) => { throw new Error(`REDIRECT:${path}`) }),
}))

import { readSessionUser } from '@/lib/auth/session'
import { getAuthUser, requireRole, roleHome } from './dal'

beforeEach(() => vi.clearAllMocks())

describe('getAuthUser', () => {
  it('redirects to /login when there is no session', async () => {
    readSessionUser.mockResolvedValue(null)
    await expect(getAuthUser()).rejects.toThrow(/^REDIRECT:\/login$/)
  })

  it('redirects to account_suspended when the user is inactive', async () => {
    readSessionUser.mockResolvedValue({ id: 'u1', role: 'lecturer', is_active: false, removed_at: null })
    await expect(getAuthUser()).rejects.toThrow('REDIRECT:/login?error=account_suspended')
  })

  it('redirects to account_suspended when the user is removed', async () => {
    readSessionUser.mockResolvedValue({ id: 'u1', role: 'lecturer', is_active: true, removed_at: new Date() })
    await expect(getAuthUser()).rejects.toThrow('REDIRECT:/login?error=account_suspended')
  })

  it('returns the user when session + account are valid', async () => {
    const u = { id: 'u1', role: 'lecturer', is_active: true, removed_at: null, must_change_password: false }
    readSessionUser.mockResolvedValue(u)
    await expect(getAuthUser()).resolves.toEqual(u)
  })
})

describe('requireRole', () => {
  it('returns the user when the role is allowed', async () => {
    const u = { id: 'u1', role: 'lecturer', is_active: true, removed_at: null, must_change_password: false }
    readSessionUser.mockResolvedValue(u)
    await expect(requireRole('lecturer', 'school_admin')).resolves.toEqual(u)
  })

  it('redirects to the role home when the role is not allowed', async () => {
    readSessionUser.mockResolvedValue({ id: 'u1', role: 'student', is_active: true, removed_at: null })
    await expect(requireRole('lecturer')).rejects.toThrow('REDIRECT:/lab')
  })

  it('redirects a staff user with must_change_password to /update-password', async () => {
    readSessionUser.mockResolvedValue({ id: 'u1', role: 'school_admin', is_active: true, removed_at: null, must_change_password: true })
    await expect(requireRole('school_admin')).rejects.toThrow('REDIRECT:/update-password')
  })
})

describe('roleHome', () => {
  it('maps known roles', () => {
    expect(roleHome('super_admin')).toBe('/admin/dashboard')
    expect(roleHome('student')).toBe('/lab')
  })
  it('falls back to /login', () => {
    expect(roleHome('bogus')).toBe('/login')
  })
})
