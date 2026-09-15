import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'
import { listActiveEntries, createEntry, listAllEntries, setEntryActive, addRange } from './labIpAllowlist'

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

  it('listAllEntries includes both active and inactive rows', async () => {
    const { university } = await seedMinimalStructure()
    const admin = await aUser(university.id)
    const row = await createEntry({ universityId: university.id, entry: '192.168.1.11', label: null, createdBy: admin.id })
    await prisma.labIpAllowlist.update({ where: { id: row.id }, data: { is_active: false } })
    const rows = await listAllEntries(university.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].is_active).toBe(false)
  })

  it('setEntryActive flips is_active', async () => {
    const { university } = await seedMinimalStructure()
    const admin = await aUser(university.id)
    const row = await createEntry({ universityId: university.id, entry: '192.168.1.11', label: null, createdBy: admin.id })
    const updated = await setEntryActive(row.id, false)
    expect(updated.is_active).toBe(false)
  })

  it('addRange creates one row per host in the range', async () => {
    const { university } = await seedMinimalStructure()
    const admin = await aUser(university.id)
    const created = await addRange({ universityId: university.id, startIp: '192.168.1.10', endIp: '192.168.1.12', label: 'Lab A', createdBy: admin.id })
    expect(created).toHaveLength(3)
    const rows = await listAllEntries(university.id)
    expect(rows.map(r => r.entry).sort()).toEqual(['192.168.1.10', '192.168.1.11', '192.168.1.12'])
  })

  it('addRange skips hosts already present instead of erroring', async () => {
    const { university } = await seedMinimalStructure()
    const admin = await aUser(university.id)
    await createEntry({ universityId: university.id, entry: '192.168.1.11', label: null, createdBy: admin.id })
    const created = await addRange({ universityId: university.id, startIp: '192.168.1.10', endIp: '192.168.1.12', label: null, createdBy: admin.id })
    expect(created).toHaveLength(2)
    const rows = await listAllEntries(university.id)
    expect(rows).toHaveLength(3)
  })

  it('addRange rejects a range where start is after end', async () => {
    const { university } = await seedMinimalStructure()
    const admin = await aUser(university.id)
    await expect(addRange({ universityId: university.id, startIp: '192.168.1.20', endIp: '192.168.1.10', label: null, createdBy: admin.id })).rejects.toThrow()
  })

  it('addRange rejects a range larger than 1024 hosts', async () => {
    const { university } = await seedMinimalStructure()
    const admin = await aUser(university.id)
    await expect(addRange({ universityId: university.id, startIp: '10.0.0.0', endIp: '10.0.4.255', label: null, createdBy: admin.id })).rejects.toThrow()
  })
})
