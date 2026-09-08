import 'server-only'
import { prisma } from '@/lib/db/client'

const SAFE_USER_SELECT = {
  id: true, email: true, full_name: true, role: true, university_id: true,
  matric_number: true, level: true, department_id: true, faculty_id: true,
  is_active: true, removed_at: true, must_change_password: true,
}

export async function findUserByEmailForAuth(email) {
  // DB collation is case-insensitive (SQL_Latin1_General_CP1_CI_AS), so a
  // plain equality match handles Admin@PCU.edu == admin@pcu.edu.
  return prisma.user.findFirst({
    where: { email },
    select: {
      id: true, email: true, role: true, university_id: true,
      is_active: true, removed_at: true, must_change_password: true, password_hash: true,
    },
  })
}

export async function findUserById(id) {
  return prisma.user.findUnique({ where: { id }, select: SAFE_USER_SELECT })
}

export async function setUserPassword(id, password_hash) {
  await prisma.user.update({
    where: { id },
    data: { password_hash, must_change_password: false },
  })
}
