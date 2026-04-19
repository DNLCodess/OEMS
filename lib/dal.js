import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ROLE_HOME } from '@/lib/utils'

/**
 * Returns the authenticated user's full profile from public.users.
 * Cached per request — safe to call multiple times in one render pass.
 * Redirects to /login if the session is missing or invalid.
 */
export const getAuthUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) redirect('/login')

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, email, full_name, role, university_id, matric_number, level, department_id, faculty_id, is_active')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) redirect('/login')

  if (!profile.is_active) redirect('/login?error=account_suspended')

  return profile
})

/**
 * Verifies the user has one of the allowed roles.
 * Call at the top of every Server Action and layout.
 */
export async function requireRole(...roles) {
  const user = await getAuthUser()
  if (!roles.includes(user.role)) {
    redirect(ROLE_HOME[user.role] ?? '/login')
  }
  return user
}

/**
 * Returns the home route for a given role.
 */
export function roleHome(role) {
  return ROLE_HOME[role] ?? '/login'
}
