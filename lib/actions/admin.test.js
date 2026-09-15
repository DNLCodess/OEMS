import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/dal', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/auth/password', () => ({ hashPassword: vi.fn(async () => 'HASHED') }))
vi.mock('@/lib/db/repositories/users', () => ({
  findUserByEmailForAuth: vi.fn(),
  findUserById: vi.fn(),
  createStaffUser: vi.fn(),
  createStudentUser: vi.fn(),
  setUserActive: vi.fn(),
  markUserRemoved: vi.fn(),
}))
vi.mock('@/lib/db/repositories/students', () => ({ findStudentByMatric: vi.fn() }))
vi.mock('@/lib/db/repositories/structure', () => ({
  createFaculty: vi.fn(),
  createDepartment: vi.fn(),
  createCourse: vi.fn(),
}))
vi.mock('@/lib/db/repositories/institution', () => ({ updateInstitution: vi.fn() }))
vi.mock('@/lib/db/repositories/labIpAllowlist', () => ({
  createEntry: vi.fn(),
  addRange: vi.fn(),
  setEntryActive: vi.fn(),
}))
vi.mock('@/lib/db/repositories/auditLog', () => ({ recordAuthEvent: vi.fn() }))
vi.mock('@/lib/security/clientIp', () => ({ isValidEntry: vi.fn(() => true) }))

import { requireRole } from '@/lib/dal'
import { findUserByEmailForAuth, findUserById, createStaffUser, createStudentUser, setUserActive, markUserRemoved } from '@/lib/db/repositories/users'
import { findStudentByMatric } from '@/lib/db/repositories/students'
import { createFaculty, createDepartment, createCourse } from '@/lib/db/repositories/structure'
import { updateInstitution } from '@/lib/db/repositories/institution'
import { createEntry, addRange, setEntryActive } from '@/lib/db/repositories/labIpAllowlist'
import { recordAuthEvent } from '@/lib/db/repositories/auditLog'
import { isValidEntry } from '@/lib/security/clientIp'
import {
  inviteUser, bulkUploadStudents, createFaculty as createFacultyAction, createDepartment as createDepartmentAction,
  createCourse as createCourseAction, updateInstitutionSettings, toggleUserActive, removeUser,
  addLabIpAllowlistEntry, addLabIpAllowlistRange, toggleLabIpAllowlistEntry,
} from './admin'

const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
const ADMIN = { id: 'admin-1', university_id: 'uni-1', role: 'school_admin' }

beforeEach(() => {
  vi.clearAllMocks()
  requireRole.mockResolvedValue(ADMIN)
  isValidEntry.mockReturnValue(true)
})

describe('inviteUser', () => {
  it('rejects an already-registered email', async () => {
    findUserByEmailForAuth.mockResolvedValue({ id: 'existing' })
    const r = await inviteUser(undefined, fd({ email: 'a@pcu.edu', full_name: 'An Admin', role: 'lecturer' }))
    expect(r.errors.email[0]).toMatch(/already registered/i)
    expect(createStaffUser).not.toHaveBeenCalled()
  })

  it('creates a staff user with a hashed temp password and returns it once', async () => {
    findUserByEmailForAuth.mockResolvedValue(null)
    createStaffUser.mockResolvedValue({ id: 'new-1' })
    const r = await inviteUser(undefined, fd({ email: 'a@pcu.edu', full_name: 'An Admin', role: 'lecturer' }))
    expect(r.ok).toBe(true)
    expect(r.email).toBe('a@pcu.edu')
    expect(typeof r.tempPassword).toBe('string')
    expect(createStaffUser).toHaveBeenCalledWith(expect.objectContaining({ passwordHash: 'HASHED', role: 'lecturer' }))
  })

  it('rejects an invalid role', async () => {
    findUserByEmailForAuth.mockResolvedValue(null)
    const r = await inviteUser(undefined, fd({ email: 'a@pcu.edu', full_name: 'An Admin', role: 'student' }))
    expect(r.errors.role).toBeDefined()
    expect(createStaffUser).not.toHaveBeenCalled()
  })
})

describe('bulkUploadStudents', () => {
  it('creates new students and reports already-registered ones as failed', async () => {
    findStudentByMatric.mockImplementation(async (m) => (m === 'CSC/2021/001' ? { id: 'exists' } : null))
    createStudentUser.mockResolvedValue({ id: 'new' })
    const roster = 'CSC/2021/001,Existing Student,300\nCSC/2021/002,New Student,200'
    const r = await bulkUploadStudents(undefined, fd({ roster }))
    expect(r.ok).toBe(true)
    expect(r.createdCount).toBe(1)
    expect(r.failed).toEqual([{ matric_number: 'CSC/2021/001', reason: 'Already registered' }])
  })

  it('rejects an empty roster', async () => {
    const r = await bulkUploadStudents(undefined, fd({ roster: '' }))
    expect(r.errors._form).toBeDefined()
  })
})

describe('createFaculty / createDepartment / createCourse', () => {
  it('createFaculty maps a P2002 to a field error', async () => {
    createFaculty.mockRejectedValue({ code: 'P2002' })
    const r = await createFacultyAction(undefined, fd({ name: 'Science' }))
    expect(r.errors.name[0]).toMatch(/already exists/i)
  })

  it('createFaculty happy path', async () => {
    createFaculty.mockResolvedValue({ id: 'f1' })
    const r = await createFacultyAction(undefined, fd({ name: 'Science' }))
    expect(r.ok).toBe(true)
  })

  it('createDepartment maps a P2002 to a field error', async () => {
    createDepartment.mockRejectedValue({ code: 'P2002' })
    const r = await createDepartmentAction(undefined, fd({ name: 'CS', faculty_id: 'f1' }))
    expect(r.errors.name[0]).toMatch(/already exists/i)
  })

  it('createCourse maps a P2002 to a field error', async () => {
    createCourse.mockRejectedValue({ code: 'P2002' })
    const r = await createCourseAction(undefined, fd({
      course_code: 'CSC 301', course_title: 'Intro Course', department_id: '11111111-1111-4111-8111-111111111111', credit_units: '3', level: '300', semester: 'first',
    }))
    expect(r.errors.course_code[0]).toMatch(/already exists/i)
  })

  it('createCourse happy path', async () => {
    createCourse.mockResolvedValue({ id: 'c1' })
    const r = await createCourseAction(undefined, fd({
      course_code: 'CSC 301', course_title: 'Intro Course', department_id: '11111111-1111-4111-8111-111111111111', credit_units: '3', level: '300', semester: 'first',
    }))
    expect(r.ok).toBe(true)
  })
})

describe('updateInstitutionSettings', () => {
  it('requires super_admin', async () => {
    await updateInstitutionSettings(undefined, fd({ name: 'PCU' }))
    expect(requireRole).toHaveBeenCalledWith('super_admin')
  })

  it('happy path updates the institution', async () => {
    updateInstitution.mockResolvedValue({ id: 'uni-1' })
    const r = await updateInstitutionSettings(undefined, fd({ name: 'PCU', primary_color: '#112233', logo_url: '/x.png' }))
    expect(r.ok).toBe(true)
    expect(updateInstitution).toHaveBeenCalledWith({ name: 'PCU', logoUrl: '/x.png', primaryColor: '#112233' })
  })

  it('rejects a name shorter than 3 chars', async () => {
    const r = await updateInstitutionSettings(undefined, fd({ name: 'PC' }))
    expect(r.errors.name).toBeDefined()
    expect(updateInstitution).not.toHaveBeenCalled()
  })
})

describe('toggleUserActive', () => {
  it('refuses to act on your own account', async () => {
    const r = await toggleUserActive('admin-1')
    expect(r.error).toMatch(/cannot deactivate your own/i)
    expect(setUserActive).not.toHaveBeenCalled()
  })

  it('refuses on a removed user', async () => {
    findUserById.mockResolvedValue({ id: 'u2', is_active: false, removed_at: new Date(), university_id: 'uni-1' })
    const r = await toggleUserActive('u2')
    expect(r.error).toMatch(/removed/i)
  })

  it('flips active state and logs the event', async () => {
    findUserById.mockResolvedValue({ id: 'u2', is_active: true, removed_at: null, university_id: 'uni-1' })
    const r = await toggleUserActive('u2')
    expect(r.ok).toBe(true)
    expect(r.is_active).toBe(false)
    expect(setUserActive).toHaveBeenCalledWith('u2', false)
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'deactivated', target_user_id: 'u2' }))
  })
})

describe('removeUser', () => {
  it('refuses to act on your own account', async () => {
    const r = await removeUser('admin-1')
    expect(r.error).toMatch(/cannot remove your own/i)
    expect(markUserRemoved).not.toHaveBeenCalled()
  })

  it('refuses on an already-removed user', async () => {
    findUserById.mockResolvedValue({ id: 'u2', removed_at: new Date(), university_id: 'uni-1' })
    const r = await removeUser('u2')
    expect(r.error).toMatch(/already been removed/i)
  })

  it('happy path marks removed and logs the event', async () => {
    findUserById.mockResolvedValue({ id: 'u2', removed_at: null, university_id: 'uni-1' })
    const r = await removeUser('u2')
    expect(r.ok).toBe(true)
    expect(markUserRemoved).toHaveBeenCalledWith('u2')
    expect(recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'removed', target_user_id: 'u2' }))
  })
})

describe('lab IP allowlist actions', () => {
  it('addLabIpAllowlistEntry rejects a malformed entry', async () => {
    isValidEntry.mockReturnValue(false)
    const r = await addLabIpAllowlistEntry(undefined, fd({ entry: 'nope' }))
    expect(r.errors.entry).toBeDefined()
    expect(createEntry).not.toHaveBeenCalled()
  })

  it('addLabIpAllowlistEntry happy path', async () => {
    const r = await addLabIpAllowlistEntry(undefined, fd({ entry: '192.168.1.11', label: 'Lab A' }))
    expect(r.ok).toBe(true)
    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ entry: '192.168.1.11', universityId: 'uni-1' }))
  })

  it('addLabIpAllowlistRange happy path', async () => {
    addRange.mockResolvedValue([{}, {}, {}])
    const r = await addLabIpAllowlistRange(undefined, fd({ start_ip: '192.168.1.10', end_ip: '192.168.1.12' }))
    expect(r.ok).toBe(true)
    expect(r.count).toBe(3)
  })

  it('addLabIpAllowlistRange surfaces a repo error as a form error', async () => {
    addRange.mockRejectedValue(new Error('Range too large (max 1024 hosts)'))
    const r = await addLabIpAllowlistRange(undefined, fd({ start_ip: '10.0.0.0', end_ip: '10.0.4.255' }))
    expect(r.errors._form).toMatch(/too large/i)
  })

  it('toggleLabIpAllowlistEntry calls the repo', async () => {
    const r = await toggleLabIpAllowlistEntry('entry-1', false)
    expect(r.ok).toBe(true)
    expect(setEntryActive).toHaveBeenCalledWith('entry-1', false)
  })
})
