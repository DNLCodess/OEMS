import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb } from '@/tests/helpers/db'
import { seed } from './seed.mjs'

describe('prisma/seed', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('creates exactly one university and one super_admin', async () => {
    await seed()
    expect(await prisma.university.count()).toBe(1)
    const admins = await prisma.user.findMany({ where: { role: 'super_admin' } })
    expect(admins).toHaveLength(1)
    expect(admins[0].must_change_password).toBe(true)
    expect(admins[0].password_hash).not.toBeNull()
  })

  it('the seeded admin password verifies', async () => {
    const { verifyPassword } = await import('@/lib/auth/password')
    await seed()
    const admin = await prisma.user.findFirst({ where: { role: 'super_admin' } })
    expect(await verifyPassword(admin.password_hash, process.env.SEED_SUPER_ADMIN_PASSWORD || 'dev-only-bootstrap-change-me')).toBe(true)
  })

  it('is re-runnable without creating duplicates', async () => {
    await seed()
    await seed()
    expect(await prisma.university.count()).toBe(1)
    expect(await prisma.user.count({ where: { role: 'super_admin' } })).toBe(1)
  })
})
