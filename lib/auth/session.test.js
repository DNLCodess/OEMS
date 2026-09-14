import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'

// In-memory cookie jar standing in for next/headers.
const jar = new Map()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined),
    set: (n, v) => jar.set(n, v),
    delete: (n) => jar.delete(n),
  }),
}))

import { createSession, readSessionUser, destroySession, readStudentSession } from '@/lib/auth/session'
import { SESSION_COOKIE } from '@/lib/auth/constants'

async function aUser(extra = {}) {
  const { university } = await seedMinimalStructure()
  return prisma.user.create({
    data: { university_id: university.id, role: 'lecturer', email: 'l@pcu.edu', full_name: 'L', ...extra },
  })
}

describe('lib/auth/session', () => {
  beforeEach(async () => { jar.clear(); await resetDb() })
  afterAll(() => prisma.$disconnect())

  it('createSession writes a hashed row and sets an opaque cookie', async () => {
    const u = await aUser()
    await createSession({ userId: u.id, channel: 'password' })

    const token = jar.get(SESSION_COOKIE)
    expect(token).toBeTruthy()
    const rows = await prisma.session.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).not.toBe(token)
    expect(rows[0].id).toHaveLength(64)
    expect(rows[0].channel).toBe('password')
  })

  it('readSessionUser returns the user for a live session', async () => {
    const u = await aUser()
    await createSession({ userId: u.id, channel: 'password' })
    const user = await readSessionUser()
    expect(user.id).toBe(u.id)
    expect(user).not.toHaveProperty('password_hash')
  })

  it('returns null and deletes the row when past expires_at', async () => {
    const u = await aUser()
    await createSession({ userId: u.id, channel: 'password' })
    const id = (await prisma.session.findFirst()).id
    await prisma.session.update({ where: { id }, data: { expires_at: new Date(Date.now() - 1000) } })

    expect(await readSessionUser()).toBeNull()
    expect(await prisma.session.count()).toBe(0)
  })

  it('returns null past the 7-day absolute cap even if expires_at is future', async () => {
    const u = await aUser()
    await createSession({ userId: u.id, channel: 'password' })
    const id = (await prisma.session.findFirst()).id
    await prisma.session.update({
      where: { id },
      data: { created_at: new Date(Date.now() - 8 * 24 * 3600_000) },
    })
    expect(await readSessionUser()).toBeNull()
  })

  it('returns null when the cookie is absent', async () => {
    expect(await readSessionUser()).toBeNull()
  })

  it('destroySession deletes the row and clears the cookie', async () => {
    const u = await aUser()
    await createSession({ userId: u.id, channel: 'password' })
    await destroySession()
    expect(jar.has(SESSION_COOKIE)).toBe(false)
    expect(await prisma.session.count()).toBe(0)
  })

  it('rejects an unknown channel', async () => {
    const u = await aUser()
    await expect(createSession({ userId: u.id, channel: 'nope' })).rejects.toThrow()
  })

  it('readStudentSession exposes channel and verifiedExamId alongside the user', async () => {
    const { university, course } = await seedMinimalStructure()
    const lecturer = await prisma.user.create({
      data: { university_id: university.id, role: 'lecturer', email: 'l2@pcu.edu', full_name: 'L2' },
    })
    const exam = await prisma.exam.create({
      data: {
        university_id: university.id, created_by: lecturer.id, course_id: course.id,
        title: 'Demo Exam', duration_minutes: 60, academic_session: '2025/2026',
        semester: 'first', exam_type: 'mid_semester', status: 'live', access_code: 'ABC123',
      },
    })
    const u = await prisma.user.create({
      data: { university_id: university.id, role: 'student', email: 's2@pcu.edu', full_name: 'S2', matric_number: 'CSC/2021/001' },
    })
    await createSession({ userId: u.id, channel: 'exam_access', verifiedExamId: exam.id })
    const session = await readStudentSession()
    expect(session.user.id).toBe(u.id)
    expect(session.channel).toBe('exam_access')
    expect(session.verifiedExamId).toBe(exam.id)
  })

  it('readStudentSession returns null with no session cookie', async () => {
    expect(await readStudentSession()).toBeNull()
  })
})
