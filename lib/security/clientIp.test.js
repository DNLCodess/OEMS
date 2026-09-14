import { describe, it, expect, afterEach } from 'vitest'
import { resolveClientIp, isIpAllowed } from './clientIp'

function headersFrom(obj) {
  const map = new Map(Object.entries(obj))
  return { get: (k) => map.get(k.toLowerCase()) ?? map.get(k) ?? null }
}

describe('resolveClientIp', () => {
  const ORIGINAL = process.env.TRUST_PROXY
  afterEach(() => { process.env.TRUST_PROXY = ORIGINAL })

  it('TRUST_PROXY=0 (default) reads x-pcu-direct-ip and ignores X-Forwarded-For even if present', () => {
    process.env.TRUST_PROXY = '0'
    const h = headersFrom({ 'x-pcu-direct-ip': '192.168.1.11', 'x-forwarded-for': '9.9.9.9' })
    expect(resolveClientIp(h)).toBe('192.168.1.11')
  })

  it('TRUST_PROXY unset behaves like 0', () => {
    delete process.env.TRUST_PROXY
    const h = headersFrom({ 'x-pcu-direct-ip': '192.168.1.11' })
    expect(resolveClientIp(h)).toBe('192.168.1.11')
  })

  it('TRUST_PROXY=1 reads the rightmost X-Forwarded-For hop', () => {
    process.env.TRUST_PROXY = '1'
    const h = headersFrom({ 'x-forwarded-for': '9.9.9.9, 192.168.1.11' })
    expect(resolveClientIp(h)).toBe('192.168.1.11')
  })

  it('TRUST_PROXY=1 with no X-Forwarded-For returns null', () => {
    process.env.TRUST_PROXY = '1'
    const h = headersFrom({})
    expect(resolveClientIp(h)).toBeNull()
  })

  it('TRUST_PROXY=0 with no direct-ip header returns null', () => {
    process.env.TRUST_PROXY = '0'
    const h = headersFrom({})
    expect(resolveClientIp(h)).toBeNull()
  })
})

describe('isIpAllowed', () => {
  it('matches an exact IPv4 entry', () => {
    expect(isIpAllowed('192.168.1.11', [{ entry: '192.168.1.11' }])).toBe(true)
  })

  it('rejects an IP not in the list', () => {
    expect(isIpAllowed('192.168.1.99', [{ entry: '192.168.1.11' }])).toBe(false)
  })

  it('matches a CIDR range', () => {
    expect(isIpAllowed('192.168.1.42', [{ entry: '192.168.1.0/24' }])).toBe(true)
  })

  it('rejects an IP outside a CIDR range', () => {
    expect(isIpAllowed('192.168.2.42', [{ entry: '192.168.1.0/24' }])).toBe(false)
  })

  it('fails closed on an empty allowlist', () => {
    expect(isIpAllowed('192.168.1.11', [])).toBe(false)
  })

  it('fails closed on a null/undefined ip', () => {
    expect(isIpAllowed(null, [{ entry: '192.168.1.0/24' }])).toBe(false)
  })

  it('fails closed on a malformed entry instead of throwing', () => {
    expect(isIpAllowed('192.168.1.11', [{ entry: 'not-an-ip' }])).toBe(false)
  })

  it('fails closed on a non-IPv4 ip (e.g. IPv6)', () => {
    expect(isIpAllowed('::1', [{ entry: '::1' }])).toBe(false)
  })
})
