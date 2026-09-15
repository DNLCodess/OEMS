import 'server-only'
import { prisma } from '@/lib/db/client'

export async function listFaculties() {
  return prisma.faculty.findMany({ orderBy: { name: 'asc' } })
}

export async function createFaculty(universityId, name) {
  return prisma.faculty.create({ data: { university_id: universityId, name } })
}

export async function listDepartments() {
  return prisma.department.findMany({ orderBy: { name: 'asc' } })
}

export async function createDepartment({ universityId, facultyId, name }) {
  return prisma.department.create({ data: { university_id: universityId, faculty_id: facultyId, name } })
}

export async function listCourses() {
  return prisma.course.findMany({
    orderBy: { course_code: 'asc' },
    include: { department: { include: { faculty: true } } },
  })
}

export async function createCourse({ universityId, courseCode, courseTitle, departmentId, creditUnits, level, semester }) {
  return prisma.course.create({
    data: {
      university_id: universityId, course_code: courseCode, course_title: courseTitle,
      department_id: departmentId, credit_units: creditUnits, level, semester,
    },
  })
}
