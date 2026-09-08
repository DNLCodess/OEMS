import 'server-only'
import { prisma } from '@/lib/db/client'

// Columns safe to hand to React components — never password_hash.
const SAFE_USER_SELECT = {
  id: true, email: true, full_name: true, role: true, university_id: true,
  matric_number: true, level: true, department_id: true, faculty_id: true,
  is_active: true, removed_at: true, must_change_password: true,
}

export async function createSessionRow(data) {
  await prisma.session.create({ data })
}

export async function findSessionWithUser(id) {
  return prisma.session.findUnique({
    where: { id },
    select: {
      id: true, created_at: true, last_seen_at: true, expires_at: true,
      channel: true, verified_exam_id: true,
      user: { select: SAFE_USER_SELECT },
    },
  })
}

export async function touchSession(id, last_seen_at, expires_at) {
  await prisma.session.update({ where: { id }, data: { last_seen_at, expires_at } })
}

export async function deleteSession(id) {
  // deleteMany — no throw if the row is already gone.
  await prisma.session.deleteMany({ where: { id } })
}

export async function deleteExpiredSessions(now) {
  const { count } = await prisma.session.deleteMany({ where: { expires_at: { lt: now } } })
  return count
}
