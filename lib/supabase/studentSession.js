import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const GENERIC_SESSION_ERROR = { error: 'Could not start session.' }

/**
 * Establishes a real Supabase session for a verified, credential-less
 * student — no password is ever generated or used. Uses the admin API to
 * generate a one-time magic-link token, then verifies it server-side to
 * set the session cookie in this request.
 */
export async function mintStudentSession(email) {
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

  return { ok: true }
}
