import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readDraft, writeDraft, clearDraft, debounce } from '@/lib/hooks/formDraftStorage'

function createMockStorage() {
  const store = new Map()
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
}

describe('formDraftStorage', () => {
  let storage

  beforeEach(() => {
    storage = createMockStorage()
    vi.stubGlobal('localStorage', storage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writeDraft then readDraft round-trips values', () => {
    writeDraft('k1', { title: 'hello', count: 3 })
    expect(readDraft('k1')).toEqual({ title: 'hello', count: 3 })
  })

  it('readDraft returns null when nothing stored', () => {
    expect(readDraft('missing')).toBeNull()
  })

  it('readDraft returns null and clears the key when JSON is corrupted', () => {
    storage.setItem('bad', '{not valid json')
    expect(readDraft('bad')).toBeNull()
    expect(storage.getItem('bad')).toBeNull()
  })

  it('clearDraft removes the stored key', () => {
    writeDraft('k2', { a: 1 })
    clearDraft('k2')
    expect(readDraft('k2')).toBeNull()
  })

  it('writeDraft degrades silently when storage throws (e.g. quota exceeded)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('quota exceeded') },
      removeItem: () => {},
    })
    expect(() => writeDraft('k3', { a: 1 })).not.toThrow()
  })

  it('readDraft returns null when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(readDraft('k4')).toBeNull()
  })
})

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('only invokes fn once, after the delay, with the last call\'s args', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 500)
    debounced('a')
    debounced('b')
    debounced('c')
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('c')
  })

  it('cancel() prevents a pending invocation', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 500)
    debounced('a')
    debounced.cancel()
    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
  })
})
