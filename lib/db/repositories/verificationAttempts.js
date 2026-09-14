import 'server-only'
import { prisma } from '@/lib/db/client'

const RATE_LIMIT_WINDOW_MINUTES = 15
const RATE_LIMIT_MAX_ATTEMPTS = 5

export async function isRateLimited(matricNumber) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000)
  const count = await prisma.verificationAttempt.count({
    where: { matric_number: matricNumber, created_at: { gte: since } },
  })
  return count >= RATE_LIMIT_MAX_ATTEMPTS
}

export async function recordFailedAttempt(matricNumber, ip) {
  await prisma.verificationAttempt.create({ data: { matric_number: matricNumber, ip } })
}

export async function clearFailedAttempts(matricNumber) {
  await prisma.verificationAttempt.deleteMany({ where: { matric_number: matricNumber } })
}
