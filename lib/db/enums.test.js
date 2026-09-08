import { describe, it, expect } from 'vitest'
import {
  USER_ROLES, STUDENT_LEVELS, EXAM_STATUSES, QUESTION_TYPES,
  SESSION_CHANNELS, ACCESS_CODE_MODES, ADMIN_LOG_ACTIONS, ENUM_VALUES,
} from '@/lib/db/enums'

describe('lib/db/enums', () => {
  it('lists the four user roles', () => {
    expect(USER_ROLES).toEqual(['super_admin', 'school_admin', 'lecturer', 'student'])
  })

  it('keeps PG in student levels', () => {
    expect(STUDENT_LEVELS).toContain('PG')
  })

  it('exam statuses match the state machine', () => {
    expect(EXAM_STATUSES).toEqual(['draft', 'scheduled', 'live', 'closed'])
  })

  it('has six question types', () => {
    expect(QUESTION_TYPES).toHaveLength(6)
  })

  it('session channels cover the three auth paths', () => {
    expect(SESSION_CHANNELS).toEqual(['password', 'exam_access', 'result_lookup'])
  })

  it('access code modes are auto/manual', () => {
    expect(ACCESS_CODE_MODES).toEqual(['auto', 'manual'])
  })

  it('admin log actions include the new IP-block action', () => {
    expect(ADMIN_LOG_ACTIONS).toContain('exam_entry_ip_blocked')
  })

  it('arrays are frozen', () => {
    expect(Object.isFrozen(USER_ROLES)).toBe(true)
  })

  it('ENUM_VALUES maps table.column keys', () => {
    expect(ENUM_VALUES['users.role']).toBe(USER_ROLES)
    expect(ENUM_VALUES['exams.status']).toBe(EXAM_STATUSES)
  })
})
