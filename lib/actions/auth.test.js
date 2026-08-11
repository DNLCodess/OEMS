import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/dal', () => ({
  requireRole: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path) => { throw new Error(`REDIRECT:${path}`) }),
}))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/dal'
import { signIn, signOut, forgotPassword, updatePassword } from './auth'

function formData(fields) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

const lecturer = { id: 'lect-1', role: 'lecturer', university_id: 'uni-1' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'
  requireRole.mockResolvedValue(lecturer)
})

describe('signIn', () => {
  it('returns validation errors for an invalid email without calling Supabase', async () => {
    const client = createMockSupabaseClient()
    createClient.mockResolvedValue(client)

    const result = await signIn(undefined, formData({ email: 'nope', password: 'secret1' }))

    expect(result.errors.email).toContain('Enter a valid email address')
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('returns a friendly error for invalid credentials and logs a login_failed event', async () => {
    const client = createMockSupabaseClient()
    client.auth.signInWithPassword.mockResolvedValue({ data: null, error: { message: 'Invalid login credentials' } })
    createClient.mockResolvedValue(client)

    const adminClient = createMockSupabaseClient({ admin_action_log: [{ data: null, error: null }] })
    createAdminClient.mockReturnValue(adminClient)

    const result = await signIn(undefined, formData({ email: 'user@example.com', password: 'secret1' }))

    expect(result.errors._form).toBe('Incorrect email or password. Please try again.')
    expect(adminClient.from).toHaveBeenCalledWith('admin_action_log')
  })

  it('returns a generic error for other Supabase auth failures without logging', async () => {
    const client = createMockSupabaseClient()
    client.auth.signInWithPassword.mockResolvedValue({ data: null, error: { message: 'Network error' } })
    createClient.mockResolvedValue(client)

    const result = await signIn(undefined, formData({ email: 'user@example.com', password: 'secret1' }))

    expect(result.errors._form).toBe('Something went wrong. Please try again later.')
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('redirects to the role home on success and logs a logged_in event', async () => {
    const client = createMockSupabaseClient({
      users: [{ data: { role: 'lecturer', university_id: 'uni-1' }, error: null }],
    })
    client.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    createClient.mockResolvedValue(client)

    const adminClient = createMockSupabaseClient({ admin_action_log: [{ data: null, error: null }] })
    createAdminClient.mockReturnValue(adminClient)

    await expect(signIn(undefined, formData({ email: 'user@example.com', password: 'secret1' })))
      .rejects.toThrow('REDIRECT:/lecturer/dashboard')

    expect(adminClient.from).toHaveBeenCalledWith('admin_action_log')
  })
})

describe('signOut', () => {
  it('signs out and redirects to /login, logging a logged_out event', async () => {
    const client = createMockSupabaseClient()
    client.auth.signOut.mockResolvedValue({ error: null })
    client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    createClient.mockResolvedValue(client)

    const adminClient = createMockSupabaseClient({
      users: [{ data: { role: 'lecturer', university_id: 'uni-1' }, error: null }],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    await expect(signOut()).rejects.toThrow(/^REDIRECT:\/login$/)

    expect(client.auth.signOut).toHaveBeenCalled()
    expect(adminClient.from).toHaveBeenCalledWith('admin_action_log')
  })
})

describe('forgotPassword', () => {
  it('returns validation errors for an invalid email', async () => {
    const client = createMockSupabaseClient()
    createClient.mockResolvedValue(client)

    const result = await forgotPassword(undefined, formData({ email: 'nope' }))

    expect(result.errors.email).toBeDefined()
    expect(client.auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('always returns success for a valid email, even if Supabase errors', async () => {
    const client = createMockSupabaseClient()
    client.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'boom' } })
    createClient.mockResolvedValue(client)

    const result = await forgotPassword(undefined, formData({ email: 'user@example.com' }))

    expect(result).toEqual({ success: true })
    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'user@example.com',
      { redirectTo: 'http://localhost:3000/auth/update-password' }
    )
  })
})

describe('updatePassword', () => {
  it('restricts password updates to staff roles', async () => {
    const client = createMockSupabaseClient()
    client.auth.updateUser.mockResolvedValue({ error: null })
    createClient.mockResolvedValue(client)

    await expect(updatePassword(undefined, formData({ password: 'longenough', confirmPassword: 'longenough' })))
      .rejects.toThrow('REDIRECT:/login?message=password_updated')

    expect(requireRole).toHaveBeenCalledWith('lecturer', 'school_admin', 'super_admin')
  })

  it('rejects mismatched passwords', async () => {
    const client = createMockSupabaseClient()
    createClient.mockResolvedValue(client)

    const result = await updatePassword(undefined, formData({ password: 'longenough', confirmPassword: 'different' }))

    expect(result.errors.confirmPassword).toContain('Passwords do not match')
  })

  it('returns a form error when Supabase fails to update the password', async () => {
    const client = createMockSupabaseClient()
    client.auth.updateUser.mockResolvedValue({ error: { message: 'expired' } })
    createClient.mockResolvedValue(client)

    const result = await updatePassword(undefined, formData({ password: 'longenough', confirmPassword: 'longenough' }))

    expect(result.errors._form).toBe('Failed to update password. The link may have expired.')
  })

  it('redirects to /login on success', async () => {
    const client = createMockSupabaseClient()
    client.auth.updateUser.mockResolvedValue({ error: null })
    createClient.mockResolvedValue(client)

    await expect(updatePassword(undefined, formData({ password: 'longenough', confirmPassword: 'longenough' })))
      .rejects.toThrow('REDIRECT:/login?message=password_updated')
  })
})
