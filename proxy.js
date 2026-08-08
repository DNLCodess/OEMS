import { NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const PUBLIC_PATHS = ['/login', '/forgot-password', '/dev']
const EXACT_PUBLIC_PATHS = ['/lab', '/check-result']

const ROLE_HOME = {
  super_admin:  '/super-admin/dashboard',
  school_admin: '/admin/dashboard',
  lecturer:     '/lecturer/dashboard',
  student:      '/student/dashboard',
}

export async function proxy(request) {
  const { supabaseResponse, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  const isExactPublicPath = EXACT_PUBLIC_PATHS.includes(pathname)
  const isPublicAuthPath  = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  const isPublicPath      = isPublicAuthPath || isExactPublicPath

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
