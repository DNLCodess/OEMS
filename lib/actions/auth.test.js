import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/repositories/users', () => ({
  findUserByEmailForAuth: vi.fn(),
  setUserPassword: vi.fn(),
}))
vi.mock('@/lib/auth/password', () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(async () => 'NEWHASH'),
}))
vi.mock('@/lib/auth/session', () => ({
  createSession: vi.fn(),
  destroySession: vi.fn(),
  readSessionUser: vi.fn(),
}))
vi.mock('@/lib/db/repositories/auditLog', () => ({ recordAuthEvent: vi.fn() }))
vi.mock('@/lib/dal', () => ({
  getAuthUser: vi.fn(),
  roleHome: (r) => ({ super_admin: '/admin/dashboard', school_admin: '/admin/dashboard', lecturer: '/lecturer/dashboard', student: '/lab' }[r] ?? '/login'),
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((p) => { throw new Error(`REDIRECT:${p}`) }),
}))

import { findUserByEmailForAuth, setUserPassword } from '@/lib/db/repositories/users'
import { verifyPassword } from '@/lib/auth/password'
import { createSession, destroySession, readSessionUser } from '@/lib/auth/session'
import { recordAuthEvent } from '@/lib/db/repositories/auditLog'
import { getAuthUser } from '@/lib/dal'
import { signIn, signOut, updatePassword } from './auth'

const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }

beforeEach(() => vi.clearAllMocks())

describe('signIn', () => {
  it('returns field errors for an invalid email, without touching the DB', async () => {
    const r = await signIn(undefined, fd({ email: 'nope', password: 'secret1' }))
    expect(r.errors.email).toBeDefined()
    expect(findUserByEmailForAuth).not.toHaveBeenCalled()
  })

  it('generic error + login_failed audit for an unknown email', async () => {
    findUserByEmailForAuth.mockResolvedValue(null)
    const r = await signIn(undefined, fd({ email: 'ghost@pcu.edu', password: 'secret1' }))
    expect(r.errors._form).toBe('Incorrect email or password. Please try again.')
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'login_failed', target_identifier: 'ghost@pcu.edu' }))
    expect(createSession).not.toHaveBeenCalled()
  })

  it('generic error + login_failed audit for a wrong password', async () => {
    findUserByEmailForAuth.mockResolvedValue({ id: 'u1', role: 'lecturer', university_id: 'uni', is_active: true, removed_at: null, must_change_password: false, password_hash: 'H' })
    verifyPassword.mockResolvedValue(false)
    const r = await signIn(undefined, fd({ email: 'l@pcu.edu', password: 'wrongpw' }))
    expect(r.errors._form).toBe('Incorrect email or password. Please try again.')
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'login_failed', target_user_id: 'u1' }))
    expect(createSession).not.toHaveBeenCalled()
  })

  it('suspended account gets a distinct message and no session', async () => {
    findUserByEmailForAuth.mockResolvedValue({ id: 'u1', role: 'lecturer', university_id: 'uni', is_active: false, removed_at: null, must_change_password: false, password_hash: 'H' })
    verifyPassword.mockResolvedValue(true)
    const r = await signIn(undefined, fd({ email: 'l@pcu.edu', password: 'rightpw' }))
    expect(r.errors._form).toMatch(/suspended/i)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('creates a session and redirects to the role home on success', async () => {
    findUserByEmailForAuth.mockResolvedValue({ id: 'u1', role: 'lecturer', university_id: 'uni', is_active: true, removed_at: null, must_change_password: false, password_hash: 'H' })
    verifyPassword.mockResolvedValue(true)
    await expect(signIn(undefined, fd({ email: 'l@pcu.edu', password: 'rightpw' }))).rejects.toThrow('REDIRECT:/lecturer/dashboard')
    expect(createSession).toHaveBeenCalledWith({ userId: 'u1', channel: 'password' })
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'logged_in', actor_id: 'u1' }))
  })

  it('redirects to /update-password when must_change_password is set', async () => {
    findUserByEmailForAuth.mockResolvedValue({ id: 'u1', role: 'school_admin', university_id: 'uni', is_active: true, removed_at: null, must_change_password: true, password_hash: 'H' })
    verifyPassword.mockResolvedValue(true)
    await expect(signIn(undefined, fd({ email: 'a@pcu.edu', password: 'rightpw' }))).rejects.toThrow('REDIRECT:/update-password')
    expect(createSession).toHaveBeenCalled()
  })
})

describe('signOut', () => {
  it('audits, destroys the session, redirects to /login', async () => {
    readSessionUser.mockResolvedValue({ id: 'u1', role: 'lecturer', university_id: 'uni' })
    await expect(signOut()).rejects.toThrow(/^REDIRECT:\/login$/)
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'logged_out', actor_id: 'u1' }))
    expect(destroySession).toHaveBeenCalled()
  })

  it('still destroys + redirects when there is no live session', async () => {
    readSessionUser.mockResolvedValue(null)
    await expect(signOut()).rejects.toThrow(/^REDIRECT:\/login$/)
    expect(destroySession).toHaveBeenCalled()
  })
})

describe('updatePassword', () => {
  it('rejects a non-staff session', async () => {
    getAuthUser.mockResolvedValue({ id: 's1', role: 'student' })
    await expect(updatePassword(undefined, fd({ password: 'longenough', confirmPassword: 'longenough' }))).rejects.toThrow('REDIRECT:/lab')
    expect(setUserPassword).not.toHaveBeenCalled()
  })

  it('rejects mismatched passwords', async () => {
    getAuthUser.mockResolvedValue({ id: 'u1', role: 'lecturer' })
    const r = await updatePassword(undefined, fd({ password: 'longenough', confirmPassword: 'different' }))
    expect(r.errors.confirmPassword).toBeDefined()
  })

  it('hashes, saves, and redirects to the role home on success', async () => {
    getAuthUser.mockResolvedValue({ id: 'u1', role: 'lecturer' })
    await expect(updatePassword(undefined, fd({ password: 'longenough', confirmPassword: 'longenough' }))).rejects.toThrow('REDIRECT:/lecturer/dashboard')
    expect(setUserPassword).toHaveBeenCalledWith('u1', 'NEWHASH')
  })
})

describe('forgotPassword', () => {
  it('is no longer exported', async () => {
    const mod = await import('./auth')
    expect(mod.forgotPassword).toBeUndefined()
  })
})
