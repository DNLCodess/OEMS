import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'

describe('lib/db/client', () => {
  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('exposes a singleton PrismaClient', async () => {
    const { prisma: again } = await import('@/lib/db/client')
    expect(again).toBe(prisma)
  })

  it('can execute a trivial query against SQL Server', async () => {
    const rows = await prisma.$queryRawUnsafe('SELECT 1 AS one')
    expect(rows).toEqual([{ one: 1 }])
  })
})
