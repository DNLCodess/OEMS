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

export async function listStaffAndStudents({ excludeUserId } = {}) {
  return prisma.user.findMany({
    where: {
      role: { in: ['super_admin', 'school_admin', 'lecturer', 'student'] },
      ...(excludeUserId && { id: { not: excludeUserId } }),
    },
    select: { ...SAFE_USER_SELECT, created_at: true, department: { select: { name: true } } },
    orderBy: [{ role: 'asc' }, { full_name: 'asc' }],
  })
}

export async function createStaffUser({ universityId, email, fullName, role, departmentId = null, facultyId = null, passwordHash }) {
  return prisma.user.create({
    data: {
      university_id: universityId, email, full_name: fullName, role,
      department_id: departmentId, faculty_id: facultyId,
      password_hash: passwordHash, must_change_password: true,
    },
  })
}

export async function createStudentUser({ universityId, email, fullName, matricNumber, level, dateOfBirth = null, departmentId = null, facultyId = null }) {
  return prisma.user.create({
    data: {
      university_id: universityId, email, full_name: fullName, role: 'student',
      matric_number: matricNumber, level, date_of_birth: dateOfBirth,
      department_id: departmentId, faculty_id: facultyId,
    },
  })
}

export async function setUserActive(id, isActive) {
  return prisma.user.update({
    where: { id },
    data: { is_active: isActive },
    select: { id: true, is_active: true, university_id: true },
  })
}

export async function markUserRemoved(id) {
  return prisma.user.update({
    where: { id },
    data: { is_active: false, removed_at: new Date() },
    select: { id: true, university_id: true, removed_at: true, is_active: true },
  })
}
