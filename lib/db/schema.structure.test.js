import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'

describe('schema: institution structure', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('creates a full university → course chain', async () => {
    const { university, course } = await seedMinimalStructure()
    const loaded = await prisma.course.findUnique({
      where: { id: course.id },
      include: { department: { include: { faculty: true } } },
    })
    expect(loaded.department.faculty.university_id).toBe(university.id)
  })

  it('enforces unique course_code per university', async () => {
    const { university, department } = await seedMinimalStructure()
    await expect(
      prisma.course.create({
        data: {
          university_id: university.id, department_id: department.id,
          course_code: 'CSC 301', course_title: 'Dup',
          credit_units: 2, level: '300', semester: 'first',
        },
      }),
    ).rejects.toThrow()
  })

  it('cascades faculty delete down to courses', async () => {
    const { faculty, course } = await seedMinimalStructure()
    await prisma.faculty.delete({ where: { id: faculty.id } })
    expect(await prisma.course.findUnique({ where: { id: course.id } })).toBeNull()
  })

  it('rejects an out-of-range credit_units', async () => {
    const { university, department } = await seedMinimalStructure()
    await expect(
      prisma.course.create({
        data: {
          university_id: university.id, department_id: department.id,
          course_code: 'CSC 999', course_title: 'Bad',
          credit_units: 9, level: '300', semester: 'first',
        },
      }),
    ).rejects.toThrow()
  })
})
