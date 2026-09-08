'use server'

import { redirect } from 'next/navigation'
import { loginSchema, resetPasswordSchema } from '@/lib/validations/auth'
import { findUserByEmailForAuth, setUserPassword } from '@/lib/db/repositories/users'
import { verifyPassword, hashPassword } from '@/lib/auth/password'
import { createSession, destroySession, readSessionUser } from '@/lib/auth/session'
import { recordAuthEvent } from '@/lib/db/repositories/auditLog'
import { getAuthUser, roleHome } from '@/lib/dal'

const GENERIC_LOGIN_ERROR = { errors: { _form: 'Incorrect email or password. Please try again.' } }
const SUSPENDED_ERROR = { errors: { _form: 'Your account has been suspended. Contact your Exam Officer.' } }
const STAFF_ROLES = ['super_admin', 'school_admin', 'lecturer']

export async function signIn(prevState, formData) {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }

  const { email, password } = parsed.data
  const user = await findUserByEmailForAuth(email)
  const ok = user?.password_hash ? await verifyPassword(user.password_hash, password) : false

  if (!user || !ok) {
    await recordAuthEvent(
      user
        ? { action: 'login_failed', target_user_id: user.id, target_identifier: email, university_id: user.university_id ?? null }
        : { action: 'login_failed', target_identifier: email },
    )
    return GENERIC_LOGIN_ERROR
  }

  if (!user.is_active || user.removed_at) return SUSPENDED_ERROR

  await createSession({ userId: user.id, channel: 'password' })
  await recordAuthEvent({
    action: 'logged_in',
    actor_id: user.id,
    target_user_id: user.id,
    university_id: user.university_id ?? null,
    subject_role: user.role,
  })

  if (user.must_change_password) redirect('/update-password')
  redirect(roleHome(user.role))
}

export async function signOut() {
  const user = await readSessionUser()
  if (user) {
    await recordAuthEvent({
      action: 'logged_out',
      actor_id: user.id,
      target_user_id: user.id,
      university_id: user.university_id ?? null,
      subject_role: user.role,
    })
  }
  await destroySession()
  redirect('/login')
}

export async function updatePassword(prevState, formData) {
  // Server Actions are independently callable — re-check the session here,
  // not just on the page. A student session must never set a staff password.
  const user = await getAuthUser()
  if (!STAFF_ROLES.includes(user.role)) redirect(roleHome(user.role))

  const parsed = resetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }

  await setUserPassword(user.id, await hashPassword(parsed.data.password))
  redirect(roleHome(user.role))
}
