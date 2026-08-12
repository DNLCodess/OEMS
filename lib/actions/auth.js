'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/dal'
import { loginSchema, forgotPasswordSchema, resetPasswordSchema } from '@/lib/validations/auth'
import { ROLE_HOME } from '@/lib/utils'

async function logAuthEvent(adminClient, fields) {
  const { error } = await adminClient.from('admin_action_log').insert(fields)
  if (error) console.error('[auth] log insert failed', error.message)
}

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
    // Only a genuine bad-credentials rejection is a security-relevant
    // "login_failed" event — an infra hiccup (network error, etc.) isn't
    // evidence of anyone trying (and failing) to get in. Deliberately no
    // lookup of whether this email belongs to a real account, so logging
    // can never become a new way to detect account existence.
    if (error.message === 'Invalid login credentials') {
      await logAuthEvent(createAdminClient(), {
        action:            'login_failed',
        target_identifier: parsed.data.email,
      })
    }

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
    .select('role, university_id')
    .eq('id', data.user.id)
    .single()

  // Only present when this sign-in came from a /{slug}/login URL (Task 3) —
  // plain /login never renders this field, so this whole block is a no-op
  // for every existing call site. This is a "wrong portal" mismatch, not a
  // credential problem: the password already checked out, so this doesn't
  // log a login_failed event — it just doesn't continue into their
  // dashboard from a URL that isn't theirs.
  const universitySlug = formData.get('university_slug')?.trim().toLowerCase() || null
  if (universitySlug) {
    // Service-role client, not the RLS-scoped `supabase` — under RLS a
    // non-super_admin account can only ever see its own university row
    // (members_read_own_university), so a lookup for a DIFFERENT
    // university's slug would silently come back empty and this whole
    // mismatch check would never fire for ordinary staff.
    const { data: uni } = await createAdminClient()
      .from('universities')
      .select('id')
      .eq('subdomain', universitySlug)
      .maybeSingle()
    if (uni && uni.id !== profile?.university_id) {
      await supabase.auth.signOut()
      return {
        errors: {
          _form: "This sign-in page belongs to a different institution. Use your own institution's link, or the general sign-in page.",
        },
      }
    }
  }

  await logAuthEvent(createAdminClient(), {
    university_id:  profile?.university_id ?? null,
    actor_id:       data.user.id,
    action:         'logged_in',
    target_user_id: data.user.id,
    subject_role:   profile?.role ?? null,
  })

  const home = ROLE_HOME[profile?.role] ?? '/login'
  redirect(home)
}

export async function signOut() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const adminClient = createAdminClient()
    const { data: profile } = await adminClient
      .from('users')
      .select('role, university_id')
      .eq('id', user.id)
      .single()

    await logAuthEvent(adminClient, {
      university_id:  profile?.university_id ?? null,
      actor_id:       user.id,
      action:         'logged_out',
      target_user_id: user.id,
      subject_role:   profile?.role ?? null,
    })
  }

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
  // Defense-in-depth: Server Actions are independently callable RPC
  // endpoints, so page-level protection alone isn't enough — a
  // credential-less student session must never be able to set a real,
  // permanent password on their otherwise-passwordless account.
  await requireRole('lecturer', 'school_admin', 'super_admin')

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
