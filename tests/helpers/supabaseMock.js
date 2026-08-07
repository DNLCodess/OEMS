import { vi } from 'vitest'

const CHAIN_METHODS = ['select', 'eq', 'in', 'order', 'single', 'maybeSingle', 'gte', 'update', 'insert', 'upsert']

function createQueryBuilder(table, nextResponse) {
  const builder = {}
  for (const method of CHAIN_METHODS) {
    builder[method] = vi.fn(() => builder)
  }
  builder.then = (onFulfilled, onRejected) =>
    Promise.resolve().then(() => nextResponse(table)).then(onFulfilled, onRejected)
  return builder
}

/**
 * Creates a fake Supabase client for tests. `tableResponses` maps table
 * names to an ordered queue of `{ data, error }` results — each awaited
 * query against that table shifts the next one off the queue.
 */
export function createMockSupabaseClient(tableResponses = {}) {
  const queues = {}
  for (const [table, responses] of Object.entries(tableResponses)) {
    queues[table] = [...responses]
  }

  function nextResponse(table) {
    const queue = queues[table]
    if (!queue || queue.length === 0) {
      throw new Error(`createMockSupabaseClient: no response queued for table "${table}"`)
    }
    return queue.shift()
  }

  return {
    from: vi.fn((table) => createQueryBuilder(table, nextResponse)),
    auth: {
      getUser: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      verifyOtp: vi.fn(),
      admin: {
        createUser: vi.fn(),
        generateLink: vi.fn(),
      },
    },
  }
}
