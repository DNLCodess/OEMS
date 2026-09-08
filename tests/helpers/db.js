import { prisma } from '@/lib/db/client'

export const testPrisma = prisma

// Delete all rows in FK-safe order (children first). Called in beforeEach
// of DB tests so each test starts from empty.
export async function resetDb() {
  await prisma.$transaction([
    prisma.response.deleteMany(),
    prisma.result.deleteMany(),
    prisma.attempt.deleteMany(),
    prisma.examAccess.deleteMany(),
    prisma.examQuestion.deleteMany(),
    prisma.session.deleteMany(),
    prisma.labIpAllowlist.deleteMany(),
    prisma.adminActionLog.deleteMany(),
    prisma.exam.deleteMany(),
    prisma.questionBank.deleteMany(),
    prisma.verificationAttempt.deleteMany(),
    prisma.user.deleteMany(),
    prisma.course.deleteMany(),
    prisma.department.deleteMany(),
    prisma.faculty.deleteMany(),
    prisma.university.deleteMany(),
  ])
}

// Minimal valid rows for tests that need a parent chain.
export async function seedMinimalStructure() {
  const university = await prisma.university.create({
    data: { name: 'PCU', subdomain: 'pcu' },
  })
  const faculty = await prisma.faculty.create({
    data: { university_id: university.id, name: 'Science' },
  })
  const department = await prisma.department.create({
    data: { university_id: university.id, faculty_id: faculty.id, name: 'Computer Science' },
  })
  const course = await prisma.course.create({
    data: {
      university_id: university.id, department_id: department.id,
      course_code: 'CSC 301', course_title: 'Data Structures',
      credit_units: 3, level: '300', semester: 'first',
    },
  })
  return { university, faculty, department, course }
}
