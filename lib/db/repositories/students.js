import 'server-only'
import { prisma } from '@/lib/db/client'

const SELECT = { id: true, email: true, is_active: true, university_id: true }

export async function findStudentByMatric(matricNumber) {
  return prisma.user.findFirst({
    where: { role: 'student', matric_number: matricNumber },
    select: SELECT,
  })
}

export async function findStudentByMatricAndDob(matricNumber, dateOfBirth) {
  return prisma.user.findFirst({
    where: { role: 'student', matric_number: matricNumber, date_of_birth: dateOfBirth },
    select: SELECT,
  })
}
