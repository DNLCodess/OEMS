import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'

describe('schema: users / sessions / verification_attempts', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('creates a staff user with no matric number', async () => {
    const { university } = await seedMinimalStructure()
    const u = await prisma.user.create({
      data: { university_id: university.id, role: 'lecturer', email: 'l@pcu.edu', full_name: 'Dr L' },
    })
    expect(u.is_active).toBe(true)
    expect(u.must_change_password).toBe(false)
  })

  it('rejects a student with no matric number (ck_users_students_matric)', async () => {
    const { university } = await seedMinimalStructure()
    await expect(
      prisma.user.create({
        data: { university_id: university.id, role: 'student', email: 's@pcu.edu', full_name: 'S' },
      }),
    ).rejects.toThrow()
  })

  it('allows two staff (NULL matric) but blocks duplicate student matric per university', async () => {
    const { university } = await seedMinimalStructure()
    await prisma.user.create({ data: { university_id: university.id, role: 'lecturer', email: 'a@pcu.edu', full_name: 'A' } })
    await prisma.user.create({ data: { university_id: university.id, role: 'school_admin', email: 'b@pcu.edu', full_name: 'B' } })

    await prisma.user.create({ data: { university_id: university.id, role: 'student', email: 'c@pcu.edu', full_name: 'C', matric_number: 'CSC/2021/001' } })
    await expect(
      prisma.user.create({ data: { university_id: university.id, role: 'student', email: 'd@pcu.edu', full_name: 'D', matric_number: 'CSC/2021/001' } }),
    ).rejects.toThrow()
  })

  it('stores and reads a session, cascades on user delete', async () => {
    const { university } = await seedMinimalStructure()
    const u = await prisma.user.create({ data: { university_id: university.id, role: 'lecturer', email: 'e@pcu.edu', full_name: 'E' } })
    await prisma.session.create({
      data: {
        id: 'a'.repeat(64), user_id: u.id, channel: 'password',
        expires_at: new Date(Date.now() + 3600_000),
      },
    })
    await prisma.user.delete({ where: { id: u.id } })
    expect(await prisma.session.findUnique({ where: { id: 'a'.repeat(64) } })).toBeNull()
  })

  it('rejects an unknown session channel', async () => {
    const { university } = await seedMinimalStructure()
    const u = await prisma.user.create({ data: { university_id: university.id, role: 'lecturer', email: 'f@pcu.edu', full_name: 'F' } })
    await expect(
      prisma.session.create({
        data: { id: 'b'.repeat(64), user_id: u.id, channel: 'telepathy', expires_at: new Date() },
      }),
    ).rejects.toThrow()
  })
})
