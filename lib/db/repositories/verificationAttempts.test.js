import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb } from '@/tests/helpers/db'
import {
  isRateLimited, recordFailedAttempt, clearFailedAttempts,
} from './verificationAttempts'

describe('repositories/verificationAttempts', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('is not rate limited with zero attempts', async () => {
    expect(await isRateLimited('CSC/2021/001')).toBe(false)
  })

  it('is rate limited at 5 attempts within the window', async () => {
    for (let i = 0; i < 5; i++) await recordFailedAttempt('CSC/2021/001', '127.0.0.1')
    expect(await isRateLimited('CSC/2021/001')).toBe(true)
  })

  it('is not rate limited at 4 attempts', async () => {
    for (let i = 0; i < 4; i++) await recordFailedAttempt('CSC/2021/001', '127.0.0.1')
    expect(await isRateLimited('CSC/2021/001')).toBe(false)
  })

  it('ignores attempts older than the 15-minute window', async () => {
    const old = new Date(Date.now() - 20 * 60 * 1000)
    for (let i = 0; i < 5; i++) {
      await prisma.verificationAttempt.create({
        data: { matric_number: 'CSC/2021/001', ip: '127.0.0.1', created_at: old },
      })
    }
    expect(await isRateLimited('CSC/2021/001')).toBe(false)
  })

  it('rate limiting is scoped per matric number', async () => {
    for (let i = 0; i < 5; i++) await recordFailedAttempt('CSC/2021/001', '127.0.0.1')
    expect(await isRateLimited('CSC/2021/002')).toBe(false)
  })

  it('clearFailedAttempts removes this matric number\'s history', async () => {
    for (let i = 0; i < 5; i++) await recordFailedAttempt('CSC/2021/001', '127.0.0.1')
    await clearFailedAttempts('CSC/2021/001')
    expect(await isRateLimited('CSC/2021/001')).toBe(false)
    expect(await prisma.verificationAttempt.count({ where: { matric_number: 'CSC/2021/001' } })).toBe(0)
  })
})
