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
import { inviteUser, bulkUploadStudents, toggleUserActive, superAdminToggleUserActive, superAdminRemoveUser, createUniversity, updateUniversityBranding } from './admin'

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

describe('inviteUser role restriction', () => {
  it('rejects role=student — students are onboarded via bulkUploadStudents instead', async () => {
    const adminClient = createMockSupabaseClient()
    createAdminClient.mockReturnValue(adminClient)

    const result = await inviteUser(undefined, formData({
      email: 'student@example.com', full_name: 'A Student', role: 'student',
    }))

    expect(result.errors.role).toBeDefined()
    expect(adminClient.auth.admin.createUser).not.toHaveBeenCalled()
  })
})

describe('bulkUploadStudents', () => {
  it('rejects an empty roster without calling the admin client', async () => {
    const adminClient = createMockSupabaseClient()
    createAdminClient.mockReturnValue(adminClient)

    const result = await bulkUploadStudents(undefined, formData({ roster: '   \n  ' }))

    expect(result.errors._form).toBeDefined()
    expect(adminClient.auth.admin.createUser).not.toHaveBeenCalled()
  })

  it('creates one auth user per valid row with no password field, and reports invalid rows', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.createUser
      .mockResolvedValueOnce({ data: { user: { id: 'stu-1' } }, error: null })
    createAdminClient.mockReturnValue(adminClient)

    const roster = [
      'CSC/2021/001,Amina Bello,300,2003-04-12',
      'not,enough,fields',
    ].join('\n')

    const result = await bulkUploadStudents(undefined, formData({ roster }))

    expect(adminClient.auth.admin.createUser).toHaveBeenCalledTimes(1)
    const call = adminClient.auth.admin.createUser.mock.calls[0][0]
    expect(call.password).toBeUndefined()
    expect(call.email).toBe('csc2021001@uni-1.students.oems.internal')
    expect(call.user_metadata).toEqual({
      full_name: 'Amina Bello',
      role: 'student',
      university_id: 'uni-1',
      matric_number: 'CSC/2021/001',
      level: '300',
      date_of_birth: '2003-04-12',
    })
    expect(result.ok).toBe(true)
    expect(result.createdCount).toBe(1)
    expect(result.failed).toHaveLength(1)
  })

  it('normalizes a lower/mixed-case pasted matric number to uppercase before storing it', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.createUser
      .mockResolvedValueOnce({ data: { user: { id: 'stu-3' } }, error: null })
    createAdminClient.mockReturnValue(adminClient)

    const result = await bulkUploadStudents(undefined, formData({ roster: 'csc/2021/003,Tunde Bello,300,2003-04-12' }))

    const call = adminClient.auth.admin.createUser.mock.calls[0][0]
    expect(call.user_metadata.matric_number).toBe('CSC/2021/003')
    // The synthetic email's local part is separately lowercased/sanitized —
    // normalization of the stored matric_number doesn't change that.
    expect(call.email).toBe('csc2021003@uni-1.students.oems.internal')
    expect(result.createdCount).toBe(1)
  })

  it('tolerates a missing date_of_birth (nullable, backfilled later)', async () => {
    const adminClient = createMockSupabaseClient()
    adminClient.auth.admin.createUser
      .mockResolvedValueOnce({ data: { user: { id: 'stu-2' } }, error: null })
    createAdminClient.mockReturnValue(adminClient)

    const result = await bulkUploadStudents(undefined, formData({ roster: 'CSC/2021/002,Femi Ade,200' }))

    const call = adminClient.auth.admin.createUser.mock.calls[0][0]
    expect(call.user_metadata.date_of_birth).toBeNull()
    expect(result.createdCount).toBe(1)
  })
})

describe('toggleUserActive', () => {
  it('rejects reactivating a removed user', async () => {
    const supabase = createMockSupabaseClient({
      users: [{ data: { id: 'user-2', is_active: false, removed_at: '2026-08-01T00:00:00Z', university_id: 'uni-1' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await toggleUserActive('user-2')

    expect(result).toEqual({ error: 'This user has been removed and cannot be reactivated.' })
  })

  it('toggles and logs the action on success', async () => {
    const supabase = createMockSupabaseClient({
      users: [
        { data: { id: 'user-2', is_active: true, removed_at: null, university_id: 'uni-1' }, error: null },
        { data: null, error: null }, // update
      ],
      admin_action_log: [{ data: null, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await toggleUserActive('user-2')

    expect(result).toEqual({ ok: true, is_active: false })
    expect(supabase.from).toHaveBeenCalledWith('admin_action_log')
  })
})

describe('superAdminToggleUserActive', () => {
  const superAdmin = { id: 'super-1', role: 'super_admin' }

  it('returns an error when the target user is not found', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const adminClient = createMockSupabaseClient({ users: [{ data: null, error: null }] })
    createAdminClient.mockReturnValue(adminClient)

    const result = await superAdminToggleUserActive('user-2')

    expect(result).toEqual({ error: 'User not found.' })
  })

  it('rejects toggling your own account', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const adminClient = createMockSupabaseClient({
      users: [{ data: { id: 'super-1', is_active: true, removed_at: null, university_id: null }, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await superAdminToggleUserActive('super-1')

    expect(result).toEqual({ error: 'You cannot deactivate your own account.' })
  })

  it('rejects reactivating a removed user', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const adminClient = createMockSupabaseClient({
      users: [{ data: { id: 'user-2', is_active: false, removed_at: '2026-08-01T00:00:00Z', university_id: 'uni-1' }, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await superAdminToggleUserActive('user-2')

    expect(result).toEqual({ error: 'This user has been removed and cannot be reactivated.' })
  })

  it('toggles and logs the action on success', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const adminClient = createMockSupabaseClient({
      users: [
        { data: { id: 'user-2', is_active: true, removed_at: null, university_id: 'uni-1' }, error: null },
        { data: null, error: null }, // update
      ],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await superAdminToggleUserActive('user-2')

    expect(result).toEqual({ ok: true, is_active: false })
    expect(adminClient.from).toHaveBeenCalledWith('admin_action_log')
  })
})

describe('superAdminRemoveUser', () => {
  const superAdmin = { id: 'super-1', role: 'super_admin' }

  it('returns an error when the target user is not found', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const adminClient = createMockSupabaseClient({ users: [{ data: null, error: null }] })
    createAdminClient.mockReturnValue(adminClient)

    const result = await superAdminRemoveUser('user-2')

    expect(result).toEqual({ error: 'User not found.' })
  })

  it('rejects removing your own account', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const adminClient = createMockSupabaseClient({
      users: [{ data: { id: 'super-1', removed_at: null, university_id: null }, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await superAdminRemoveUser('super-1')

    expect(result).toEqual({ error: 'You cannot remove your own account.' })
  })

  it('rejects removing an already-removed user', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const adminClient = createMockSupabaseClient({
      users: [{ data: { id: 'user-2', removed_at: '2026-08-01T00:00:00Z', university_id: 'uni-1' }, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await superAdminRemoveUser('user-2')

    expect(result).toEqual({ error: 'This user has already been removed.' })
  })

  it('removes the user and logs the action on success', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const adminClient = createMockSupabaseClient({
      users: [
        { data: { id: 'user-2', removed_at: null, university_id: 'uni-1' }, error: null },
        { data: null, error: null }, // update
      ],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await superAdminRemoveUser('user-2')

    expect(result).toEqual({ ok: true })
    expect(adminClient.from).toHaveBeenCalledWith('admin_action_log')
  })
})

describe('createUniversity', () => {
  const superAdmin = { id: 'super-1', role: 'super_admin' }

  it('creates a university with no color/logo (both optional)', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const supabase = createMockSupabaseClient({ universities: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await createUniversity(undefined, formData({ name: 'University of Lagos', subdomain: 'unilag' }))

    expect(result).toEqual({ ok: true })
    const universitiesBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'universities').value
    expect(universitiesBuilder.insert).toHaveBeenCalledWith({ name: 'University of Lagos', subdomain: 'unilag' })
  })

  it('rejects a primary_color too light for white button text', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const supabase = createMockSupabaseClient()
    createClient.mockResolvedValue(supabase)

    const result = await createUniversity(undefined, formData({
      name: 'University of Lagos', subdomain: 'unilag', primary_color: '#F5F5F5',
    }))

    expect(result.errors.primary_color).toBeDefined()
    expect(supabase.from).not.toHaveBeenCalledWith('universities')
  })

  it('accepts a valid primary_color and logo_url', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const supabase = createMockSupabaseClient({ universities: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await createUniversity(undefined, formData({
      name: 'University of Lagos', subdomain: 'unilag',
      primary_color: '#123456', logo_url: 'https://example.com/logo.png',
    }))

    expect(result).toEqual({ ok: true })
    const universitiesBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'universities').value
    expect(universitiesBuilder.insert).toHaveBeenCalledWith({
      name: 'University of Lagos', subdomain: 'unilag',
      primary_color: '#123456', logo_url: 'https://example.com/logo.png',
    })
  })

  it('maps a duplicate-subdomain Supabase error to a field error', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const supabase = createMockSupabaseClient({ universities: [{ data: null, error: { code: '23505' } }] })
    createClient.mockResolvedValue(supabase)

    const result = await createUniversity(undefined, formData({ name: 'Dup', subdomain: 'unilag' }))

    expect(result.errors.subdomain).toEqual(['This subdomain is already taken.'])
  })
})

describe('updateUniversityBranding', () => {
  const superAdmin = { id: 'super-1', role: 'super_admin' }

  it('rejects a primary_color too light for white button text', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const supabase = createMockSupabaseClient()
    createClient.mockResolvedValue(supabase)

    const result = await updateUniversityBranding('uni-1', undefined, formData({ primary_color: '#FFFFFF' }))

    expect(result.errors.primary_color).toBeDefined()
    expect(supabase.from).not.toHaveBeenCalledWith('universities')
  })

  it('updates the color and logo for the given university only', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const supabase = createMockSupabaseClient({ universities: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await updateUniversityBranding('uni-1', undefined, formData({
      primary_color: '#123456', logo_url: 'https://example.com/logo.png',
    }))

    expect(result).toEqual({ ok: true })
    const universitiesBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'universities').value
    expect(universitiesBuilder.update).toHaveBeenCalledWith({ primary_color: '#123456', logo_url: 'https://example.com/logo.png' })
    expect(universitiesBuilder.eq).toHaveBeenCalledWith('id', 'uni-1')
  })

  it('allows clearing both fields back to unset', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const supabase = createMockSupabaseClient({ universities: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await updateUniversityBranding('uni-1', undefined, formData({ primary_color: '', logo_url: '' }))

    expect(result).toEqual({ ok: true })
    const universitiesBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'universities').value
    expect(universitiesBuilder.update).toHaveBeenCalledWith({ primary_color: null, logo_url: null })
  })
})
