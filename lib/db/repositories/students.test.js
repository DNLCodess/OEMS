import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'
import { findStudentByMatric, findStudentByMatricAndDob } from './students'

async function aStudent(universityId, extra = {}) {
  return prisma.user.create({
    data: {
      university_id: universityId, role: 'student', email: 's@pcu.edu', full_name: 'S',
      matric_number: 'CSC/2021/001', date_of_birth: new Date('2003-05-14'), ...extra,
    },
  })
}

describe('repositories/students', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('findStudentByMatric finds an active student', async () => {
    const { university } = await seedMinimalStructure()
    const s = await aStudent(university.id)
    const found = await findStudentByMatric('CSC/2021/001')
    expect(found.id).toBe(s.id)
  })

  it('findStudentByMatric returns null for an unknown matric number', async () => {
    await seedMinimalStructure()
    expect(await findStudentByMatric('NOPE/0000/000')).toBeNull()
  })

  it('findStudentByMatric only matches role=student', async () => {
    const { university } = await seedMinimalStructure()
    await prisma.user.create({
      data: { university_id: university.id, role: 'lecturer', email: 'l@pcu.edu', full_name: 'L', matric_number: 'CSC/2021/001' },
    })
    expect(await findStudentByMatric('CSC/2021/001')).toBeNull()
  })

  it('findStudentByMatricAndDob matches on both fields', async () => {
    const { university } = await seedMinimalStructure()
    const s = await aStudent(university.id)
    const found = await findStudentByMatricAndDob('CSC/2021/001', new Date('2003-05-14'))
    expect(found.id).toBe(s.id)
  })

  it('findStudentByMatricAndDob returns null on a DOB mismatch', async () => {
    const { university } = await seedMinimalStructure()
    await aStudent(university.id)
    expect(await findStudentByMatricAndDob('CSC/2021/001', new Date('1999-01-01'))).toBeNull()
  })
})
