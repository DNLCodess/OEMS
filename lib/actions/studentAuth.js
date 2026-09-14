'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'
import { resolveClientIp, isIpAllowed } from '@/lib/security/clientIp'
import { isRateLimited, recordFailedAttempt, clearFailedAttempts } from '@/lib/db/repositories/verificationAttempts'
import { listActiveEntries } from '@/lib/db/repositories/labIpAllowlist'
import { findStudentByMatric, findStudentByMatricAndDob } from '@/lib/db/repositories/students'
import { findExamByAccessCode, findInProgressAttempt } from '@/lib/db/repositories/exams'
import { createSession, destroySession, readStudentSession } from '@/lib/auth/session'
import { recordAuthEvent } from '@/lib/db/repositories/auditLog'

const GENERIC_ERROR = { error: 'Check your details and try again.' }
const RATE_LIMITED_ERROR = { error: 'Too many attempts. Please wait 15 minutes and try again.' }
const EXAM_NOT_OPEN_ERROR = { error: "This exam hasn't opened yet. Wait for your lecturer to begin it." }
const ENTRY_CLOSED_ERROR = { error: 'Entry for this exam has closed. Speak to your invigilator.' }
const IP_BLOCKED_ERROR = { error: "This isn't an approved exam machine. Ask your invigilator." }

async function getClientIp() {
  return resolveClientIp(await headers())
}

// ─── Enter exam: matric number + per-exam access code ──────────────────────

const examAccessSchema = z.object({
  matric_number: z.string().min(1),
  access_code: z.string().length(6),
})

export async function verifyExamAccess(prevState, formData) {
  const parsed = examAccessSchema.safeParse({
    matric_number: formData.get('matric_number')?.trim().toUpperCase(),
    access_code: formData.get('access_code')?.trim().toUpperCase(),
  })
  if (!parsed.success) return GENERIC_ERROR

  const { matric_number, access_code } = parsed.data
  const ip = await getClientIp()

  if (await isRateLimited(matric_number)) return RATE_LIMITED_ERROR

  const exam = await findExamByAccessCode(access_code)

  // A revoked code must be indistinguishable from an unknown one — same
  // message, same rate-limit charge — so a leaked-then-revoked code gives
  // no signal back to whoever is trying it.
  if (!exam || exam.access_code_revoked_at) {
    await recordFailedAttempt(matric_number, ip)
    await recordAuthEvent({ action: 'login_failed', target_identifier: matric_number })
    return GENERIC_ERROR
  }

  if (exam.enforce_ip_allowlist) {
    const entries = await listActiveEntries(exam.university_id)
    // Empty allowlist + enforcement on = fail closed for everyone
    // (misconfiguration is safer than an open door).
    if (entries.length === 0 || !isIpAllowed(ip, entries)) {
      await recordAuthEvent({
        action: 'exam_entry_ip_blocked',
        target_identifier: matric_number,
        university_id: exam.university_id,
        meta: { ip },
      })
      return IP_BLOCKED_ERROR
    }
  }

  if (exam.status !== 'live') return EXAM_NOT_OPEN_ERROR

  const student = await findStudentByMatric(matric_number)

  if (!student || !student.is_active) {
    await recordFailedAttempt(matric_number, ip)
    await recordAuthEvent(student
      ? { action: 'login_failed', target_user_id: student.id, university_id: exam.university_id }
      : { action: 'login_failed', target_identifier: matric_number },
    )
    return GENERIC_ERROR
  }

  const entryDeadline = exam.go_live_at
    ? new Date(exam.go_live_at).getTime() + exam.entry_window_minutes * 60 * 1000
    : null
  const windowOpen = !!entryDeadline && Date.now() <= entryDeadline

  if (!windowOpen) {
    const existingAttempt = await findInProgressAttempt(exam.id, student.id)
    if (!existingAttempt) return ENTRY_CLOSED_ERROR
  }

  await createSession({ userId: student.id, channel: 'exam_access', verifiedExamId: exam.id, clientIp: ip })

  await clearFailedAttempts(matric_number)
  await recordAuthEvent({
    action: 'logged_in',
    target_user_id: student.id,
    actor_id: student.id,
    university_id: exam.university_id,
  })

  redirect(`/lab/${access_code}`)
}

// ─── Check result: matric number + date of birth ────────────────────────────

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

  if (await isRateLimited(matric_number)) return RATE_LIMITED_ERROR

  const student = await findStudentByMatricAndDob(matric_number, new Date(date_of_birth))

  if (!student || !student.is_active) {
    await recordFailedAttempt(matric_number, ip)
    await recordAuthEvent(student
      ? { action: 'login_failed', target_user_id: student.id, university_id: student.university_id }
      : { action: 'login_failed', target_identifier: matric_number },
    )
    return GENERIC_ERROR
  }

  await createSession({ userId: student.id, channel: 'result_lookup', verifiedExamId: null, clientIp: ip })

  await clearFailedAttempts(matric_number)
  await recordAuthEvent({
    action: 'logged_in',
    target_user_id: student.id,
    actor_id: student.id,
    university_id: student.university_id,
  })

  redirect('/check-result')
}

// ─── End session (kiosk hygiene) ────────────────────────────────────────────

function isSafeReturnPath(returnTo) {
  return returnTo === '/check-result'
}

export async function endStudentSession(code, returnTo) {
  const session = await readStudentSession()
  if (session) {
    await recordAuthEvent({
      action: 'logged_out',
      target_user_id: session.user.id,
      actor_id: session.user.id,
      university_id: session.user.university_id ?? null,
    })
  }

  await destroySession()
  const destination = isSafeReturnPath(returnTo) ? returnTo : (code ? `/lab/${code}` : '/lab')
  redirect(destination)
}
