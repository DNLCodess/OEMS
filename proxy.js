import { NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const PUBLIC_PATHS = ['/login', '/forgot-password', '/dev']
// /check-result and /lab both have dynamic sub-routes that each carry their
// own gate further down (requireRole('student'), or the unauthenticated-safe
// admin-client lookup + notFound() pattern) — the proxy layer only needs to
// avoid blocking unauthenticated visitors, so both match as a prefix, not an
// exact path. /check-result was previously exact-only; moved here so
// /check-result/{slug} (university-scoped result lookup) is also public.
const PREFIX_PUBLIC_PATHS = ['/lab', '/check-result']
// Matches /{slug}/login and /{slug}/forgot-password — the university-branded
// entry points. Unlike /lab and /check-result, these belong in the same
// bucket as plain /login/forgot-password below: an already-authenticated
// visitor who lands on one should be redirected to their own dashboard, not
// stay on a sign-in page.
const UNIVERSITY_AUTH_PATH = /^\/[a-z0-9-]+\/(login|forgot-password)$/i

const ROLE_HOME = {
  super_admin:  '/super-admin/dashboard',
  school_admin: '/admin/dashboard',
  lecturer:     '/lecturer/dashboard',
  student:      '/lab',
}

export async function proxy(request) {
  const { supabaseResponse, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  const isPrefixPublicPath = PREFIX_PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  const isPublicAuthPath   = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/')) || UNIVERSITY_AUTH_PATH.test(pathname)
  const isPublicPath       = isPublicAuthPath || isPrefixPublicPath

  // No session — redirect to login, preserving the intended destination
  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Authenticated user visiting a public auth page (/login, /forgot-password,
  // /dev, or a /{slug} variant of the first two) — send to their dashboard.
  // Role is read from user_metadata (set on signup) to avoid a DB call here.
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
