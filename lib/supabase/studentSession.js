import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const GENERIC_SESSION_ERROR = { error: 'Could not start session.' }

/**
 * Establishes a real Supabase session for a verified, credential-less
 * student — no password is ever generated or used. Uses the admin API to
 * generate a one-time magic-link token, then verifies it server-side to
 * set the session cookie in this request.
 *
 * `channel` records which verification path was used to mint this session
 * ('exam_access' or 'result_lookup') so downstream actions can refuse to
 * treat a result-lookup session as good enough to sit an exam. It's stored
 * in the auth user's `app_metadata` — settable only via the admin API,
 * never by the browser — and read back later with a live `getUser()` call,
 * so it can't be spoofed the way a client-writable cookie could be.
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

  const { error: metadataError } = await adminClient.auth.admin.updateUserById(data.user.id, {
    app_metadata: { session_channel: channel },
  })

  if (metadataError) {
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
