import 'server-only'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const GENERIC_SESSION_ERROR = { error: 'Could not start session.' }

export const SESSION_CHANNEL_COOKIE = 'oems_session_channel'

/**
 * Establishes a real Supabase session for a verified, credential-less
 * student — no password is ever generated or used. Uses the admin API to
 * generate a one-time magic-link token, then verifies it server-side to
 * set the session cookie in this request.
 *
 * `channel` records which verification path was used to mint this session
 * ('exam_access' or 'result_lookup') so downstream actions can refuse to
 * treat a result-lookup session as good enough to sit an exam.
 */
export async function mintStudentSession(email, channel) {
  const adminClient = createAdminClient()

  const { data, error } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  if (error || !data?.properties?.hashed_token) {
    return GENERIC_SESSION_ERROR
  }

  const supabase = await createClient()

  // Prevent session bleed between students sharing a kiosk/lab machine.
  await supabase.auth.signOut()

  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: data.properties.hashed_token,
  })

  if (verifyError) {
    return GENERIC_SESSION_ERROR
  }

  const cookieStore = await cookies()
  cookieStore.set(SESSION_CHANNEL_COOKIE, channel, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    // No maxAge — session cookie, expires when the browser closes.
    // Appropriate for kiosk safety (shared/lab machines).
    path: '/',
  })

  return { ok: true }
}
