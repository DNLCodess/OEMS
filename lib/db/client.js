import { PrismaClient } from '@prisma/client'

// A single PrismaClient per process. In dev, Next.js / Vitest re-evaluate
// modules on hot reload; without this guard each reload leaks a new pool
// until SQL Server refuses connections.
const globalForPrisma = globalThis

export const prisma =
  globalForPrisma.__pcuPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === '1' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__pcuPrisma = prisma
}
