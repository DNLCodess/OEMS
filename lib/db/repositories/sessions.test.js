import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'
import {
  createSessionRow, findSessionWithUser, touchSession, deleteSession, deleteExpiredSessions,
} from '@/lib/db/repositories/sessions'

async function aUser(extra = {}) {
  const { university } = await seedMinimalStructure()
  return prisma.user.create({
    data: { university_id: university.id, role: 'lecturer', email: 'l@pcu.edu', full_name: 'L', ...extra },
  })
}

const H = (c) => c.repeat(64)

describe('repositories/sessions', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('creates and reads back a session joined to a safe user projection', async () => {
    const u = await aUser()
    const now = new Date()
    await createSessionRow({
      id: H('a'), user_id: u.id, channel: 'password', verified_exam_id: null, client_ip: null,
      created_at: now, last_seen_at: now, expires_at: new Date(now.getTime() + 3600_000),
    })
    const row = await findSessionWithUser(H('a'))
    expect(row.user.id).toBe(u.id)
    expect(row.user).not.toHaveProperty('password_hash')
    expect(row.channel).toBe('password')
  })

  it('returns null for an unknown id', async () => {
    expect(await findSessionWithUser(H('z'))).toBeNull()
  })

  it('touch updates last_seen_at and expires_at', async () => {
    const u = await aUser()
    const t0 = new Date('2026-01-01T00:00:00Z')
    await createSessionRow({
      id: H('b'), user_id: u.id, channel: 'password', verified_exam_id: null, client_ip: null,
      created_at: t0, last_seen_at: t0, expires_at: new Date('2026-01-01T12:00:00Z'),
    })
    const t1 = new Date('2026-01-01T06:00:00Z')
    await touchSession(H('b'), t1, new Date('2026-01-01T18:00:00Z'))
    const row = await findSessionWithUser(H('b'))
    expect(row.last_seen_at.toISOString()).toBe(t1.toISOString())
    expect(row.expires_at.toISOString()).toBe('2026-01-01T18:00:00.000Z')
  })

  it('deleteSession removes exactly one row', async () => {
    const u = await aUser()
    const now = new Date()
    await createSessionRow({ id: H('c'), user_id: u.id, channel: 'password', verified_exam_id: null, client_ip: null, created_at: now, last_seen_at: now, expires_at: new Date(now.getTime() + 1000) })
    await deleteSession(H('c'))
    expect(await findSessionWithUser(H('c'))).toBeNull()
  })

  it('deleteExpiredSessions removes only rows past expires_at', async () => {
    const u = await aUser()
    const now = new Date('2026-06-01T00:00:00Z')
    await createSessionRow({ id: H('d'), user_id: u.id, channel: 'password', verified_exam_id: null, client_ip: null, created_at: now, last_seen_at: now, expires_at: new Date('2026-05-01T00:00:00Z') })
    await createSessionRow({ id: H('e'), user_id: u.id, channel: 'password', verified_exam_id: null, client_ip: null, created_at: now, last_seen_at: now, expires_at: new Date('2026-07-01T00:00:00Z') })
    const removed = await deleteExpiredSessions(now)
    expect(removed).toBe(1)
    expect(await findSessionWithUser(H('e'))).not.toBeNull()
  })
})
