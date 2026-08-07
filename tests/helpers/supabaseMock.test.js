import { describe, it, expect } from 'vitest'
import { createMockSupabaseClient } from './supabaseMock'

describe('createMockSupabaseClient', () => {
  it('resolves the queued response for a table', async () => {
    const client = createMockSupabaseClient({
      users: [{ data: { id: '1' }, error: null }],
    })

    const result = await client.from('users').select('*').eq('id', '1').single()

    expect(result).toEqual({ data: { id: '1' }, error: null })
  })

  it('shifts through multiple queued responses in order', async () => {
    const client = createMockSupabaseClient({
      users: [
        { data: { id: '1' }, error: null },
        { data: { id: '2' }, error: null },
      ],
    })

    const first = await client.from('users').select('*').single()
    const second = await client.from('users').select('*').single()

    expect(first.data.id).toBe('1')
    expect(second.data.id).toBe('2')
  })

  it('throws a clear error when no response is queued for a table', async () => {
    const client = createMockSupabaseClient({})

    await expect(client.from('users').select('*')).rejects.toThrow(
      'no response queued for table "users"'
    )
  })

  it('exposes vi.fn() auth methods that tests can configure per-case', async () => {
    const client = createMockSupabaseClient()
    client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })

    const result = await client.auth.getUser()

    expect(result.data.user.id).toBe('u1')
  })
})

describe('createMockSupabaseClient auth surface', () => {
  it('exposes generateLink and verifyOtp as mock functions', () => {
    const client = createMockSupabaseClient()
    expect(client.auth.admin.generateLink).toBeTypeOf('function')
    expect(client.auth.verifyOtp).toBeTypeOf('function')
  })

  it('chains maybeSingle and gte like the other query methods', () => {
    const client = createMockSupabaseClient({ users: [{ data: { id: 'u1' }, error: null }] })
    const builder = client.from('users').select('*').eq('id', 'u1').gte('created_at', '2026-01-01').maybeSingle()
    expect(builder).toBeDefined()
  })
})
