import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { readSessionUser } from '@/lib/auth/session'
import { ROLE_HOME } from '@/lib/utils'

const STAFF_ROLES = ['super_admin', 'school_admin', 'lecturer']

/**
 * The authenticated user's safe profile, or a redirect to /login.
 * Cached per request — safe to call many times in one render pass.
 */
export const getAuthUser = cache(async () => {
  const user = await readSessionUser()
  if (!user) redirect('/login')
  if (!user.is_active || user.removed_at) redirect('/login?error=account_suspended')
  return user
})

/**
 * Verify the user has one of the allowed roles. Call at the top of every
 * protected layout and Server Action.
 */
export async function requireRole(...roles) {
  const user = await getAuthUser()
  if (!roles.includes(user.role)) {
    redirect(ROLE_HOME[user.role] ?? '/login')
  }
  // Staff who still hold a temporary password are funnelled to set a real
  // one before they can do anything else. The /update-password page itself
  // calls getAuthUser (not requireRole) so it stays reachable.
  if (STAFF_ROLES.includes(user.role) && user.must_change_password) {
    redirect('/update-password')
  }
  return user
}

export function roleHome(role) {
  return ROLE_HOME[role] ?? '/login'
}
