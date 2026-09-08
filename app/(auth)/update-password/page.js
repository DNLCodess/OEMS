import { redirect } from 'next/navigation'
import { getAuthUser, roleHome } from '@/lib/dal'
import { UpdatePasswordForm } from './UpdatePasswordForm'

export const metadata = { title: 'Set New Password — PCU CBT' }

const STAFF_ROLES = ['super_admin', 'school_admin', 'lecturer']

export default async function UpdatePasswordPage() {
  // getAuthUser (not requireRole) — requireRole would bounce a
  // must_change_password user straight back here in a loop.
  const user = await getAuthUser()
  if (!STAFF_ROLES.includes(user.role)) redirect(roleHome(user.role))

  return <UpdatePasswordForm />
}
