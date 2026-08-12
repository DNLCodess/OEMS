import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildAttemptState, serializeAttemptDraft } from '@/lib/exam/attemptDraft'

function createMockStorage() {
  const store = new Map()
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
}

describe('buildAttemptState', () => {
  let storage

  beforeEach(() => {
    storage = createMockStorage()
    vi.stubGlobal('localStorage', storage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const responses = [
    { question_id: 'q1', student_answer: 'A' },
    { question_id: 'q2', student_answer: null },
  ]
  const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5 min ago

  it('falls back to server-confirmed answers, index 0, and no flags when no local draft exists', () => {
    const state = buildAttemptState('attempt-1', responses, startedAt, 60)

    expect(state.answers).toEqual({ q1: 'A', q2: null })
    expect(state.currentIndex).toBe(0)
    expect(state.flagged).toEqual(new Set())
  })

  it('merges local draft answers over server-confirmed ones, local winning on conflict', () => {
    storage.setItem('oems:exam:attempt-1', JSON.stringify({
      answers: { q1: 'B', q3: 'C' },
      currentIndex: 1,
      flagged: ['q2'],
    }))

    const state = buildAttemptState('attempt-1', responses, startedAt, 60)

    expect(state.answers).toEqual({ q1: 'B', q2: null, q3: 'C' })
    expect(state.currentIndex).toBe(1)
    expect(state.flagged).toEqual(new Set(['q2']))
  })

  it('always computes timeRemaining from startedAt/duration, ignoring anything in the local draft', () => {
    storage.setItem('oems:exam:attempt-1', JSON.stringify({
      answers: {},
      currentIndex: 0,
      flagged: [],
      timeRemaining: 999999, // should never be read
    }))

    const state = buildAttemptState('attempt-1', responses, startedAt, 60)

    // 60 min duration, 5 min elapsed -> ~55 min = 3300s remaining
    expect(state.timeRemaining).toBeGreaterThan(3290)
    expect(state.timeRemaining).toBeLessThanOrEqual(3300)
  })

  it('clamps timeRemaining to 0 when duration has already elapsed', () => {
    const longAgo = new Date(Date.now() - 120 * 60 * 1000).toISOString() // 2 hours ago
    const state = buildAttemptState('attempt-1', responses, longAgo, 60)

    expect(state.timeRemaining).toBe(0)
  })

  it('keys the draft lookup by attemptId, so a different attempt never sees this draft', () => {
    storage.setItem('oems:exam:attempt-1', JSON.stringify({ answers: { q1: 'B' }, currentIndex: 1, flagged: [] }))

    const state = buildAttemptState('attempt-2', responses, startedAt, 60)

    expect(state.answers).toEqual({ q1: 'A', q2: null })
    expect(state.currentIndex).toBe(0)
  })

  it('falls back cleanly when the stored draft is corrupted JSON', () => {
    storage.setItem('oems:exam:attempt-1', '{not valid json')

    const state = buildAttemptState('attempt-1', responses, startedAt, 60)

    expect(state.answers).toEqual({ q1: 'A', q2: null })
    expect(state.currentIndex).toBe(0)
    expect(state.flagged).toEqual(new Set())
  })
})

describe('serializeAttemptDraft', () => {
  it('converts the flagged Set to an array and picks exactly answers/currentIndex/flagged', () => {
    const state = {
      answers: { q1: 'A' },
      currentIndex: 2,
      flagged: new Set(['q1', 'q3']),
      timeRemaining: 1200, // must NOT be included in the persisted shape
    }

    const draft = serializeAttemptDraft(state)

    expect(draft).toEqual({
      answers: { q1: 'A' },
      currentIndex: 2,
      flagged: ['q1', 'q3'],
    })
  })
})
