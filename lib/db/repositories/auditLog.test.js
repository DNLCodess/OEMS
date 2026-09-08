import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'
import { recordAuthEvent } from '@/lib/db/repositories/auditLog'

describe('repositories/auditLog', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('writes a logged_in row with actor and subject role', async () => {
    const { university } = await seedMinimalStructure()
    const u = await prisma.user.create({
      data: { university_id: university.id, role: 'lecturer', email: 'l@pcu.edu', full_name: 'L' },
    })
    await recordAuthEvent({
      action: 'logged_in', actor_id: u.id, target_user_id: u.id,
      university_id: university.id, subject_role: 'lecturer',
    })
    const rows = await prisma.adminActionLog.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('logged_in')
    expect(rows[0].actor_id).toBe(u.id)
  })

  it('writes a login_failed row keyed only on the submitted identifier', async () => {
    await recordAuthEvent({ action: 'login_failed', target_identifier: 'ghost@pcu.edu' })
    const rows = await prisma.adminActionLog.findMany()
    expect(rows[0].target_identifier).toBe('ghost@pcu.edu')
    expect(rows[0].actor_id).toBeNull()
  })

  it('never throws on an invalid action — logs the error and returns', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(recordAuthEvent({ action: 'not_a_real_action' })).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
