'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { mintStudentSession } from '@/lib/supabase/studentSession'

const RATE_LIMIT_WINDOW_MINUTES = 15
const RATE_LIMIT_MAX_ATTEMPTS   = 5

const GENERIC_ERROR = { error: 'Check your details and try again.' }

async function getClientIp() {
  const hdrs = await headers()
  return hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

async function isRateLimited(adminClient, matricNumber, ip) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count } = await adminClient
    .from('verification_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('matric_number', matricNumber)
    .eq('ip', ip)
    .gte('created_at', since)
  return (count ?? 0) >= RATE_LIMIT_MAX_ATTEMPTS
}

async function recordFailedAttempt(adminClient, matricNumber, ip) {
  await adminClient.from('verification_attempts').insert({ matric_number: matricNumber, ip })
}

// ─── Enter exam: matric number + per-exam access code ─────────────────────────

const examAccessSchema = z.object({
  matric_number: z.string().min(1),
  access_code:   z.string().length(6),
})

export async function verifyExamAccess(prevState, formData) {
  const parsed = examAccessSchema.safeParse({
    matric_number: formData.get('matric_number')?.trim(),
    access_code:   formData.get('access_code')?.trim().toUpperCase(),
  })
  if (!parsed.success) return GENERIC_ERROR

  const { matric_number, access_code } = parsed.data
  const ip = await getClientIp()
  const adminClient = createAdminClient()

  if (await isRateLimited(adminClient, matric_number, ip)) return GENERIC_ERROR

  const { data: exam } = await adminClient
    .from('exams')
    .select('id, university_id, status')
    .eq('access_code', access_code)
    .maybeSingle()

  if (!exam || exam.status !== 'live') {
    await recordFailedAttempt(adminClient, matric_number, ip)
    return GENERIC_ERROR
  }

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

  const session = await mintStudentSession(student.email)
  if (session.error) return GENERIC_ERROR

  redirect(`/lab/${access_code}`)
}

// ─── Check result: matric number + date of birth ───────────────────────────────

const resultAccessSchema = z.object({
  matric_number: z.string().min(1),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function verifyResultAccess(prevState, formData) {
  const parsed = resultAccessSchema.safeParse({
    matric_number: formData.get('matric_number')?.trim(),
    date_of_birth: formData.get('date_of_birth'),
  })
  if (!parsed.success) return GENERIC_ERROR

  const { matric_number, date_of_birth } = parsed.data
  const ip = await getClientIp()
  const adminClient = createAdminClient()

  if (await isRateLimited(adminClient, matric_number, ip)) return GENERIC_ERROR

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

  const session = await mintStudentSession(students[0].email)
  if (session.error) return GENERIC_ERROR

  redirect('/student/results')
}
