import { NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const PUBLIC_PATHS = ['/login', '/forgot-password', '/dev']
// /check-result has no dynamic sub-routes, so an exact match is correct.
const EXACT_PUBLIC_PATHS = ['/check-result']
// /lab has dynamic sub-routes (/lab/[code], /lab/[code]/attempt/[attemptId])
// that each carry their own requireRole('student') gate, so the proxy layer
// only needs to avoid blocking unauthenticated visitors — it must match as
// a prefix, not an exact path.
const PREFIX_PUBLIC_PATHS = ['/lab']

const ROLE_HOME = {
  super_admin:  '/super-admin/dashboard',
  school_admin: '/admin/dashboard',
  lecturer:     '/lecturer/dashboard',
  student:      '/lab',
}

export async function proxy(request) {
  const { supabaseResponse, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  const isExactPublicPath  = EXACT_PUBLIC_PATHS.includes(pathname)
  const isPrefixPublicPath = PREFIX_PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  const isPublicAuthPath   = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  const isPublicPath       = isPublicAuthPath || isExactPublicPath || isPrefixPublicPath

  // No session — redirect to login, preserving the intended destination
  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Authenticated user visiting a public auth page (/login, /forgot-password,
  // /dev) — send to their dashboard. Role is read from user_metadata (set on
  // signup) to avoid a DB call here.
  //
  // /lab and /check-result are deliberately excluded: they must stay
  // reachable even with a session already present, so a student can sign
  // out-and-back-in or enter a second exam without being bounced first.
  if (user && isPublicAuthPath) {
    const role = user.user_metadata?.role
    const home = ROLE_HOME[role] ?? '/login'
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = home
    return NextResponse.redirect(homeUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
