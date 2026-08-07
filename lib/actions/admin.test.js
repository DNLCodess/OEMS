import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient } from '@/tests/helpers/supabaseMock'

vi.mock('@/lib/dal', () => ({
  requireRole: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { requireRole } from '@/lib/dal'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { inviteUser } from './admin'

function formData(fields) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

const schoolAdmin = { id: 'admin-1', role: 'school_admin', university_id: 'uni-1' }

beforeEach(() => {
  vi.clearAllMocks()
  requireRole.mockResolvedValue(schoolAdmin)
})

describe('inviteUser', () => {
  it('returns validation errors for an invalid email without creating a user', async () => {
    const adminClient = createMockSupabaseClient()
    createAdminClient.mockReturnValue(adminClient)

    const result = await inviteUser(undefined, formData({ email: 'nope', full_name: 'Jane Doe', role: 'lecturer' }))

    expect(result.errors.email).toBeDefined()
    expect(adminClient.auth.admin.createUser).not.toHaveBeenCalled()
  })

  it('requires a matric number when inviting a student', async () => {
    const adminClient = createMockSupabaseClient()
    createAdminClient.mockReturnValue(adminClient)

    const result = await inviteUser(undefined, formData({
      email: 'student@example.com', full_name: 'A Student', role: 'student',
    }))

    expect(result.errors.matric_number).toEqual(['Matric number is required for students.'])
    expect(adminClient.auth.admin.createUser).not.toHaveBeenCalled()
  })

  it('creates the user with a temporary password and the right metadata', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.createUser.mockResolvedValue({
      data: { user: { id: 'new-user-1' } },
      error: null,
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await inviteUser(undefined, formData({
      email: 'lecturer@example.com', full_name: 'Dr. New', role: 'lecturer',
    }))

    expect(adminClient.auth.admin.createUser).toHaveBeenCalledWith({
      email: 'lecturer@example.com',
      password: 'ChangeMe123!',
      email_confirm: true,
      user_metadata: {
        full_name: 'Dr. New',
        role: 'lecturer',
        university_id: 'uni-1',
        matric_number: null,
        level: null,
      },
    })
    expect(requireRole).toHaveBeenCalledWith('school_admin', 'super_admin')
    expect(result).toEqual({ ok: true, email: 'lecturer@example.com' })
  })

  it('maps a duplicate-email Supabase error to a field error', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.createUser.mockResolvedValue({
      data: null,
      error: { message: 'Email already registered' },
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await inviteUser(undefined, formData({
      email: 'dup@example.com', full_name: 'Dup User', role: 'lecturer',
    }))

    expect(result.errors.email).toEqual(['This email is already registered.'])
  })

  it('updates department and faculty after creating the user when provided', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.createUser.mockResolvedValue({
      data: { user: { id: 'new-user-2' } },
      error: null,
    })
    createAdminClient.mockReturnValue(adminClient)

    const serverClient = createMockSupabaseClient({ users: [{ data: null, error: null }] })
    createClient.mockResolvedValue(serverClient)

    const deptId = '11111111-1111-4111-a111-111111111111'
    const facId = '22222222-2222-4222-a222-222222222222'

    const result = await inviteUser(undefined, formData({
      email: 'lecturer2@example.com', full_name: 'Dr. Two', role: 'lecturer',
      department_id: deptId, faculty_id: facId,
    }))

    expect(createClient).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, email: 'lecturer2@example.com' })
  })
})
