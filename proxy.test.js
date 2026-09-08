import { describe, it, expect } from 'vitest'
import { proxy } from './proxy'
import { SESSION_COOKIE } from '@/lib/auth/constants'

function req(pathname, { withCookie = false } = {}) {
  const url = new URL(`http://localhost:3000${pathname}`)
  return {
    nextUrl: Object.assign(url, { clone: () => new URL(url.href) }),
    cookies: { has: (n) => withCookie && n === SESSION_COOKIE },
  }
}

describe('proxy', () => {
  it('redirects an unauthenticated request for a protected path to /login with ?next', () => {
    const res = proxy(req('/lecturer/dashboard'))
    expect(res.status).toBe(307)
    const loc = new URL(res.headers.get('location'))
    expect(loc.pathname).toBe('/login')
    expect(loc.searchParams.get('next')).toBe('/lecturer/dashboard')
  })

  it('lets an unauthenticated request through to a public path', () => {
    const res = proxy(req('/login'))
    expect(res.headers.get('location')).toBeNull()
  })

  it('lets /lab/* and /check-result/* through unauthenticated', () => {
    expect(proxy(req('/lab/ABC234')).headers.get('location')).toBeNull()
    expect(proxy(req('/check-result')).headers.get('location')).toBeNull()
  })

  it('lets an authenticated request through to a protected path', () => {
    const res = proxy(req('/lecturer/dashboard', { withCookie: true }))
    expect(res.headers.get('location')).toBeNull()
  })
})
