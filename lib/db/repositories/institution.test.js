import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb } from '@/tests/helpers/db'
import { getInstitution, updateInstitution } from './institution'

describe('repositories/institution', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('getInstitution returns the single university row', async () => {
    const created = await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu' } })
    const found = await getInstitution()
    expect(found.id).toBe(created.id)
  })

  it('getInstitution returns null when no row exists', async () => {
    expect(await getInstitution()).toBeNull()
  })

  it('updateInstitution updates name, logo, and color', async () => {
    await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu' } })
    const updated = await updateInstitution({ name: 'PCU Updated', logoUrl: '/pcu/logo.png', primaryColor: '#112233' })
    expect(updated.name).toBe('PCU Updated')
    expect(updated.logo_url).toBe('/pcu/logo.png')
    expect(updated.primary_color).toBe('#112233')
  })

  it('updateInstitution clears logo/color when passed null', async () => {
    await prisma.university.create({ data: { name: 'PCU', subdomain: 'pcu', logo_url: '/x.png', primary_color: '#000000' } })
    const updated = await updateInstitution({ name: 'PCU', logoUrl: null, primaryColor: null })
    expect(updated.logo_url).toBeNull()
    expect(updated.primary_color).toBeNull()
  })

  it('updateInstitution throws when no institution row exists', async () => {
    await expect(updateInstitution({ name: 'X', logoUrl: null, primaryColor: null })).rejects.toThrow()
  })
})
