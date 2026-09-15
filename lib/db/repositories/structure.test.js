import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb } from '@/tests/helpers/db'
import {
  listFaculties, createFaculty, listDepartments, createDepartment, listCourses, createCourse,
} from './structure'

describe('repositories/structure', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('createFaculty then listFaculties returns it', async () => {
    const uni = await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu' } })
    await createFaculty(uni.id, 'Science')
    const rows = await listFaculties()
    expect(rows.map(f => f.name)).toEqual(['Science'])
  })

  it('createFaculty rejects a duplicate name for the same university', async () => {
    const uni = await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu' } })
    await createFaculty(uni.id, 'Science')
    await expect(createFaculty(uni.id, 'Science')).rejects.toMatchObject({ code: 'P2002' })
  })

  it('createDepartment then listDepartments returns it', async () => {
    const uni = await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu' } })
    const fac = await createFaculty(uni.id, 'Science')
    await createDepartment({ universityId: uni.id, facultyId: fac.id, name: 'Computer Science' })
    const rows = await listDepartments()
    expect(rows.map(d => d.name)).toEqual(['Computer Science'])
  })

  it('createDepartment rejects a duplicate name within the same faculty', async () => {
    const uni = await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu' } })
    const fac = await createFaculty(uni.id, 'Science')
    await createDepartment({ universityId: uni.id, facultyId: fac.id, name: 'Computer Science' })
    await expect(createDepartment({ universityId: uni.id, facultyId: fac.id, name: 'Computer Science' })).rejects.toMatchObject({ code: 'P2002' })
  })

  it('createCourse then listCourses returns it with department and faculty', async () => {
    const uni = await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu' } })
    const fac = await createFaculty(uni.id, 'Science')
    const dept = await createDepartment({ universityId: uni.id, facultyId: fac.id, name: 'Computer Science' })
    await createCourse({
      universityId: uni.id, courseCode: 'CSC 301', courseTitle: 'Data Structures',
      departmentId: dept.id, creditUnits: 3, level: '300', semester: 'first',
    })
    const rows = await listCourses()
    expect(rows).toHaveLength(1)
    expect(rows[0].course_code).toBe('CSC 301')
    expect(rows[0].department.name).toBe('Computer Science')
    expect(rows[0].department.faculty.name).toBe('Science')
  })

  it('createCourse rejects a duplicate course code for the same university', async () => {
    const uni = await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu' } })
    const fac = await createFaculty(uni.id, 'Science')
    const dept = await createDepartment({ universityId: uni.id, facultyId: fac.id, name: 'Computer Science' })
    const data = { universityId: uni.id, courseCode: 'CSC 301', courseTitle: 'X', departmentId: dept.id, creditUnits: 3, level: '300', semester: 'first' }
    await createCourse(data)
    await expect(createCourse({ ...data, courseTitle: 'Y' })).rejects.toMatchObject({ code: 'P2002' })
  })
})
