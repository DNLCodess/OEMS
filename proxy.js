import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth/constants'

// Paths reachable without a session. /lab and /check-result carry their own
// gates deeper in (Slice 2); the proxy only avoids bouncing anonymous
// visitors away from them.
const PUBLIC_PREFIXES = ['/login', '/forgot-password', '/dev', '/lab', '/check-result']

const isPublic = (pathname) =>
  PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/')) ||
  // legacy /{slug}/login and /{slug}/forgot-password — removed in Slice 3
  /^\/[a-z0-9-]+\/(login|forgot-password)$/i.test(pathname)

export function proxy(request) {
  const { pathname } = request.nextUrl

  if (!request.cookies.has(SESSION_COOKIE) && !isPublic(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
