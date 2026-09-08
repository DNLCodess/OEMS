import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'
import { findUserByEmailForAuth, findUserById, setUserPassword } from '@/lib/db/repositories/users'

async function aUser(extra = {}) {
  const { university } = await seedMinimalStructure()
  return prisma.user.create({
    data: {
      university_id: university.id, role: 'school_admin',
      email: 'admin@pcu.edu', full_name: 'Admin', password_hash: 'HASH', ...extra,
    },
  })
}

describe('repositories/users', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('findUserByEmailForAuth returns the hash and auth flags, case-insensitively', async () => {
    await aUser({ email: 'Admin@PCU.edu' })
    const u = await findUserByEmailForAuth('admin@pcu.edu')
    expect(u.password_hash).toBe('HASH')
    expect(u.role).toBe('school_admin')
  })

  it('findUserByEmailForAuth returns null for an unknown email', async () => {
    expect(await findUserByEmailForAuth('nobody@pcu.edu')).toBeNull()
  })

  it('findUserById returns a safe projection without password_hash', async () => {
    const created = await aUser()
    const u = await findUserById(created.id)
    expect(u.email).toBe('admin@pcu.edu')
    expect(u).not.toHaveProperty('password_hash')
  })

  it('setUserPassword updates the hash and clears must_change_password', async () => {
    const created = await aUser({ must_change_password: true })
    await setUserPassword(created.id, 'NEWHASH')
    const row = await prisma.user.findUnique({ where: { id: created.id } })
    expect(row.password_hash).toBe('NEWHASH')
    expect(row.must_change_password).toBe(false)
  })
})
