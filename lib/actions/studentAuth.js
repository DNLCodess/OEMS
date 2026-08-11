'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { mintStudentSession } from '@/lib/supabase/studentSession'

const RATE_LIMIT_WINDOW_MINUTES = 15
const RATE_LIMIT_MAX_ATTEMPTS   = 5

const GENERIC_ERROR = { error: 'Check your details and try again.' }

// Safe to show as a distinct message — it's keyed only on the submitted
// matric number, not on whether the exam/access-code/DOB was actually
// correct, so it reveals nothing about validity.
const RATE_LIMITED_ERROR = { error: 'Too many attempts. Please wait 15 minutes and try again.' }

// Both of these are also safe to show as distinct messages, and neither
// should cost the student a rate-limit attempt — see the call sites below.
const EXAM_NOT_OPEN_ERROR = { error: "This exam hasn't opened yet. Wait for your lecturer to begin it." }
const ENTRY_CLOSED_ERROR = { error: 'Entry for this exam has closed. Speak to your invigilator.' }

async function getClientIp() {
  const hdrs = await headers()
  return hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

async function isRateLimited(adminClient, matricNumber) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count } = await adminClient
    .from('verification_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('matric_number', matricNumber)
    .gte('created_at', since)
  return (count ?? 0) >= RATE_LIMIT_MAX_ATTEMPTS
}

async function recordFailedAttempt(adminClient, matricNumber, ip) {
  await adminClient.from('verification_attempts').insert({ matric_number: matricNumber, ip })
}

// Clears this matric number's attempt history on a successful verification —
// otherwise a legitimate student who mistypes a few times mid-exam-day stays
// rate-limited even after finally getting it right.
async function clearFailedAttempts(adminClient, matricNumber) {
  await adminClient.from('verification_attempts').delete().eq('matric_number', matricNumber)
}

// ─── Enter exam: matric number + per-exam access code ─────────────────────────

const examAccessSchema = z.object({
  matric_number: z.string().min(1),
  access_code:   z.string().length(6),
})

export async function verifyExamAccess(prevState, formData) {
  const parsed = examAccessSchema.safeParse({
    matric_number: formData.get('matric_number')?.trim().toUpperCase(),
    access_code:   formData.get('access_code')?.trim().toUpperCase(),
  })
  if (!parsed.success) return GENERIC_ERROR

  const { matric_number, access_code } = parsed.data
  const ip = await getClientIp()
  const adminClient = createAdminClient()

  if (await isRateLimited(adminClient, matric_number)) return RATE_LIMITED_ERROR

  const { data: exam } = await adminClient
    .from('exams')
    .select('id, university_id, status, go_live_at, entry_window_minutes')
    .eq('access_code', access_code)
    .maybeSingle()

  if (!exam) {
    await recordFailedAttempt(adminClient, matric_number, ip)
    return GENERIC_ERROR
  }

  // The exam existing but not being live yet reveals nothing about whether
  // this matric number is valid — it's not a credential problem, so it
  // doesn't cost the student a rate-limit attempt.
  if (exam.status !== 'live') return EXAM_NOT_OPEN_ERROR

  const { data: student } = await adminClient
    .from('users')
    .select('id, email, is_active')
    .eq('role', 'student')
    .eq('university_id', exam.university_id)
    .eq('matric_number', matric_number)
    .maybeSingle()

  if (!student || !student.is_active) {
    await recordFailedAttempt(adminClient, matric_number, ip)
    return GENERIC_ERROR
  }

  // The entry window gates only genuinely NEW attempts — it never affects a
  // student already mid-attempt (governed from here on by their own
  // started_at + duration_minutes, checked in lib/actions/attempts.js) and
  // it never auto-closes the exam's status; "Close Exam" stays a deliberate,
  // separate lecturer action. A student who already has an in-progress
  // attempt on this exam must always be able to get back in regardless of
  // the window — session loss (crash, reboot, accidental sign-out) after
  // the window has closed is otherwise unrecoverable: the attempt would
  // stay in_progress forever with no result and no path back in. So before
  // rejecting on a closed/missing window, check for that escape hatch.
  const entryDeadline = exam.go_live_at
    ? new Date(exam.go_live_at).getTime() + exam.entry_window_minutes * 60 * 1000
    : null
  // A null go_live_at with status already 'live' shouldn't happen
  // (updateExamStatus stamps it on that exact transition) but is treated as
  // "not yet enterable" rather than "no limit" — fail closed, not open.
  const windowOpen = !!entryDeadline && Date.now() <= entryDeadline

  if (!windowOpen) {
    const { data: existingAttempt } = await adminClient
      .from('attempts')
      .select('id')
      .eq('exam_id', exam.id)
      .eq('student_id', student.id)
      .eq('status', 'in_progress')
      .maybeSingle()

    if (!existingAttempt) return ENTRY_CLOSED_ERROR
  }

  const session = await mintStudentSession(student.email, 'exam_access', exam.id)
  if (session.error) return GENERIC_ERROR

  await clearFailedAttempts(adminClient, matric_number)

  redirect(`/lab/${access_code}`)
}

// ─── Check result: matric number + date of birth ───────────────────────────────

const resultAccessSchema = z.object({
  matric_number: z.string().min(1),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function verifyResultAccess(prevState, formData) {
  const parsed = resultAccessSchema.safeParse({
    matric_number: formData.get('matric_number')?.trim().toUpperCase(),
    date_of_birth: formData.get('date_of_birth'),
  })
  if (!parsed.success) return GENERIC_ERROR

  const { matric_number, date_of_birth } = parsed.data
  const ip = await getClientIp()
  const adminClient = createAdminClient()

  if (await isRateLimited(adminClient, matric_number)) return RATE_LIMITED_ERROR

  // No university scoping here — matric numbers are only unique per
  // university, so a cross-university match is treated as ambiguous and
  // rejected the same as no match. See Global Constraints in the plan.
  const { data: students } = await adminClient
    .from('users')
    .select('id, email, is_active')
    .eq('role', 'student')
    .eq('matric_number', matric_number)
    .eq('date_of_birth', date_of_birth)

  if (!students || students.length !== 1 || !students[0].is_active) {
    await recordFailedAttempt(adminClient, matric_number, ip)
    return GENERIC_ERROR
  }

  const session = await mintStudentSession(students[0].email, 'result_lookup')
  if (session.error) return GENERIC_ERROR

  await clearFailedAttempts(adminClient, matric_number)

  redirect('/check-result')
}

// ─── End session (kiosk hygiene) ────────────────────────────────────────────

// Signs the current student out and sends them back to /lab, so the next
// person at a shared/kiosk machine doesn't inherit the session, and this
// student (or the next one) can start a fresh matric number + access code
// entry for another exam.
// Server Actions are independently callable endpoints, not gated behind the
// component that happens to invoke them in the UI — a caller can supply any
// value here directly, not just the one literal the button passes. So
// `returnTo` is checked against a fixed allowlist rather than passed straight
// to redirect(), which would otherwise let an arbitrary external URL (e.g.
// 'https://evil.example.com') be reflected back as a same-site-trusted
// redirect.
const SAFE_RETURN_PATHS = new Set(['/check-result'])

export async function endStudentSession(code, returnTo) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // A kiosk lab machine is pre-loaded once, for the whole sitting, to this
  // exam's own /lab/{code} URL — the next student at the same machine
  // should land back on that same matric-entry form, not a generic page
  // that makes them re-discover the code. `returnTo` overrides this for
  // non-exam kiosk contexts (e.g. the /check-result lookup).
  const destination = SAFE_RETURN_PATHS.has(returnTo) ? returnTo : (code ? `/lab/${code}` : '/lab')
  redirect(destination)
}
