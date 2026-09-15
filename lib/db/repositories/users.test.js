import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'
import {
  findUserByEmailForAuth, findUserById, setUserPassword,
  listStaffAndStudents, createStaffUser, createStudentUser, setUserActive, markUserRemoved,
} from '@/lib/db/repositories/users'

async function aUser(extra = {}) {
  const { university } = await seedMinimalStructure()
  return prisma.user.create({
    data: {
      university_id: university.id, role: 'school_admin',
      email: 'admin@pcu.edu', full_name: 'Admin', password_hash: 'HASH', ...extra,
    },
  })
}

describe('repositories/users', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('findUserByEmailForAuth returns the hash and auth flags, case-insensitively', async () => {
    await aUser({ email: 'Admin@PCU.edu' })
    const u = await findUserByEmailForAuth('admin@pcu.edu')
    expect(u.password_hash).toBe('HASH')
    expect(u.role).toBe('school_admin')
  })

  it('findUserByEmailForAuth returns null for an unknown email', async () => {
    expect(await findUserByEmailForAuth('nobody@pcu.edu')).toBeNull()
  })

  it('findUserById returns a safe projection without password_hash', async () => {
    const created = await aUser()
    const u = await findUserById(created.id)
    expect(u.email).toBe('admin@pcu.edu')
    expect(u).not.toHaveProperty('password_hash')
  })

  it('setUserPassword updates the hash and clears must_change_password', async () => {
    const created = await aUser({ must_change_password: true })
    await setUserPassword(created.id, 'NEWHASH')
    const row = await prisma.user.findUnique({ where: { id: created.id } })
    expect(row.password_hash).toBe('NEWHASH')
    expect(row.must_change_password).toBe(false)
  })
})

describe('repositories/users — admin management', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('createStaffUser creates a staff account with a hashed password and must_change_password', async () => {
    const { university } = await seedMinimalStructure()
    const staff = await createStaffUser({
      universityId: university.id, email: 'new@pcu.edu', fullName: 'New Staff', role: 'lecturer',
      departmentId: null, facultyId: null, passwordHash: 'HASH',
    })
    expect(staff.email).toBe('new@pcu.edu')
    expect(staff.password_hash).toBe('HASH')
    expect(staff.must_change_password).toBe(true)
  })

  it('createStudentUser creates a student with no password', async () => {
    const { university } = await seedMinimalStructure()
    const student = await createStudentUser({
      universityId: university.id, email: 's@internal', fullName: 'A Student',
      matricNumber: 'CSC/2021/001', level: '300', dateOfBirth: new Date('2003-05-14'),
      departmentId: null, facultyId: null,
    })
    expect(student.matric_number).toBe('CSC/2021/001')
    expect(student.password_hash).toBeNull()
  })

  it('listStaffAndStudents returns staff and student roles, excluding a given id', async () => {
    const { university } = await seedMinimalStructure()
    const a = await createStaffUser({ universityId: university.id, email: 'a@pcu.edu', fullName: 'A', role: 'lecturer', passwordHash: 'H' })
    const b = await createStaffUser({ universityId: university.id, email: 'b@pcu.edu', fullName: 'B', role: 'school_admin', passwordHash: 'H' })
    const rows = await listStaffAndStudents({ excludeUserId: b.id })
    expect(rows.map(r => r.id)).toEqual([a.id])
  })

  it('setUserActive flips is_active', async () => {
    const { university } = await seedMinimalStructure()
    const u = await createStaffUser({ universityId: university.id, email: 'a@pcu.edu', fullName: 'A', role: 'lecturer', passwordHash: 'H' })
    const updated = await setUserActive(u.id, false)
    expect(updated.is_active).toBe(false)
  })

  it('markUserRemoved sets is_active false and removed_at', async () => {
    const { university } = await seedMinimalStructure()
    const u = await createStaffUser({ universityId: university.id, email: 'a@pcu.edu', fullName: 'A', role: 'lecturer', passwordHash: 'H' })
    const updated = await markUserRemoved(u.id)
    expect(updated.is_active).toBe(false)
    expect(updated.removed_at).not.toBeNull()
  })
})
