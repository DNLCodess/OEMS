import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'
import { listActiveEntries, createEntry } from './labIpAllowlist'

async function aUser(universityId) {
  return prisma.user.create({
    data: { university_id: universityId, role: 'super_admin', email: 'sa@pcu.edu', full_name: 'SA' },
  })
}

describe('repositories/labIpAllowlist', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('createEntry then listActiveEntries returns it', async () => {
    const { university } = await seedMinimalStructure()
    const admin = await aUser(university.id)
    await createEntry({ universityId: university.id, entry: '192.168.1.11', label: 'Lab A row 1', createdBy: admin.id })
    const rows = await listActiveEntries(university.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].entry).toBe('192.168.1.11')
  })

  it('listActiveEntries excludes inactive rows', async () => {
    const { university } = await seedMinimalStructure()
    const admin = await aUser(university.id)
    const row = await createEntry({ universityId: university.id, entry: '192.168.1.12', label: null, createdBy: admin.id })
    await prisma.labIpAllowlist.update({ where: { id: row.id }, data: { is_active: false } })
    expect(await listActiveEntries(university.id)).toHaveLength(0)
  })

  it('listActiveEntries returns an empty array when nothing is seeded', async () => {
    const { university } = await seedMinimalStructure()
    expect(await listActiveEntries(university.id)).toEqual([])
  })

  it('listActiveEntries scopes by university', async () => {
    const { university } = await seedMinimalStructure()
    const admin = await aUser(university.id)
    await createEntry({ universityId: university.id, entry: '192.168.1.11', label: null, createdBy: admin.id })
    const otherUni = await prisma.university.create({ data: { name: 'Other', subdomain: 'other' } })
    expect(await listActiveEntries(otherUni.id)).toEqual([])
  })
})
