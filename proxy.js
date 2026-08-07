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

  const isPublicPath =
    PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/')) ||
    EXACT_PUBLIC_PATHS.includes(pathname)

  // No session — redirect to login, preserving the intended destination
  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Authenticated user visiting a public auth page — send to their dashboard.
  // Role is read from user_metadata (set on signup) to avoid a DB call here.
  if (user && isPublicPath) {
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
