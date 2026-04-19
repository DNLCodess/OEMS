'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loginSchema, forgotPasswordSchema, resetPasswordSchema } from '@/lib/validations/auth'
import { ROLE_HOME } from '@/lib/utils'

export async function signIn(prevState, formData) {
  const raw = {
    email: formData.get('email'),
    password: formData.get('password'),
  }

  const parsed = loginSchema.safeParse(raw)
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    return {
      errors: {
        _form: error.message === 'Invalid login credentials'
          ? 'Incorrect email or password. Please try again.'
          : 'Something went wrong. Please try again later.',
      },
    }
  }

  // Fetch role from profile so we can redirect to the right dashboard
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', data.user.id)
    .single()

  const home = ROLE_HOME[profile?.role] ?? '/login'
  redirect(home)
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function forgotPassword(prevState, formData) {
  const raw = { email: formData.get('email') }

  const parsed = forgotPasswordSchema.safeParse(raw)
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/update-password`,
  })

  // Always return success — avoids leaking whether an email is registered
  if (error) {
    console.error('[forgotPassword]', error.message)
  }

  return { success: true }
}

export async function updatePassword(prevState, formData) {
  const raw = {
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  }

  const parsed = resetPasswordSchema.safeParse(raw)
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })

  if (error) {
    return { errors: { _form: 'Failed to update password. The link may have expired.' } }
  }

  redirect('/login?message=password_updated')
}
