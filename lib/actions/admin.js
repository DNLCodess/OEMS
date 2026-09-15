'use server'

import { randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRole } from '@/lib/dal'
import { hashPassword } from '@/lib/auth/password'
import {
  findUserByEmailForAuth, findUserById, createStaffUser, createStudentUser, setUserActive, markUserRemoved,
} from '@/lib/db/repositories/users'
import { findStudentByMatric } from '@/lib/db/repositories/students'
// Aliased: this file exports its own createFaculty/createDepartment/createCourse
// actions with the same names — importing the repo functions unaliased would
// shadow them.
import {
  createFaculty as createFacultyRepo,
  createDepartment as createDepartmentRepo,
  createCourse as createCourseRepo,
} from '@/lib/db/repositories/structure'
import { updateInstitution } from '@/lib/db/repositories/institution'
import { createEntry, addRange, setEntryActive } from '@/lib/db/repositories/labIpAllowlist'
import { recordAuthEvent } from '@/lib/db/repositories/auditLog'
import { isValidEntry } from '@/lib/security/clientIp'
import { isDarkEnoughForWhiteText } from '@/lib/universityTheme'

const ADMIN_ROLES = ['school_admin', 'super_admin']

// A single hardcoded temp password shared by every invited account is a
// standing credential — anyone who knows the convention could sign in to
// any invited-but-not-yet-reset account. Generate a fresh one per invite;
// it's shown once to the admin who created the account.
function generateTempPassword() {
  return randomBytes(18).toString('base64url')
}

function isUniqueConstraintError(e) {
  return e?.code === 'P2002'
}

// ─── User management ─────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email:         z.string().email('Valid email required'),
  full_name:     z.string().min(2, 'Full name required'),
  role:          z.enum(['lecturer', 'school_admin']),
  department_id: z.string().uuid().optional().or(z.literal('')),
  faculty_id:    z.string().uuid().optional().or(z.literal('')),
})

export async function inviteUser(prevState, formData) {
  const admin = await requireRole(...ADMIN_ROLES)

  const parsed = inviteSchema.safeParse({
    email:         formData.get('email')?.trim(),
    full_name:     formData.get('full_name')?.trim(),
    role:          formData.get('role'),
    department_id: formData.get('department_id') || undefined,
    faculty_id:    formData.get('faculty_id') || undefined,
  })
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }
  const { email, full_name, role, department_id, faculty_id } = parsed.data

  // No unique constraint on `email` at the DB level (see Global Constraints) —
  // this check is the only thing standing between two invites colliding.
  if (await findUserByEmailForAuth(email)) {
    return { errors: { email: ['This email is already registered.'] } }
  }

  const tempPassword = generateTempPassword()
  // No audit-log entry here — the original Supabase version never logged
  // invites either (only activate/deactivate/remove/login events are
  // tracked in admin_action_log; inventing a new use of an existing action
  // like 'activated' for this would misrepresent what actually happened).
  await createStaffUser({
    universityId: admin.university_id, email, fullName: full_name, role,
    departmentId: department_id || null, facultyId: faculty_id || null,
    passwordHash: await hashPassword(tempPassword),
  })

  revalidatePath('/admin/users')
  return { ok: true, email, tempPassword }
}

// ─── Bulk student roster upload ───────────────────────────────────────────────

const studentRowSchema = z.object({
  matric_number: z.string().min(1, 'Matric number required').transform(s => s.toUpperCase()),
  full_name:     z.string().min(2, 'Full name required'),
  level:         z.enum(['100', '200', '300', '400', '500', 'PG']),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD').optional().or(z.literal('')),
})

function parseRosterText(text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [matric_number, full_name, level, date_of_birth] = line.split(',').map(s => s?.trim())
      return { matric_number, full_name, level, date_of_birth }
    })
}

// Students never get a password — they authenticate via matric number + a
// per-exam access code (lib/actions/studentAuth.js), never via email.
export async function bulkUploadStudents(prevState, formData) {
  const admin = await requireRole(...ADMIN_ROLES)
  const rosterText    = formData.get('roster') ?? ''
  const department_id = formData.get('department_id') || null
  const faculty_id     = formData.get('faculty_id') || null

  const rows = parseRosterText(rosterText)
  if (rows.length === 0) {
    return { errors: { _form: 'Paste at least one student row (matric number, full name, level).' } }
  }

  const created = []
  const failed  = []

  for (const row of rows) {
    const parsed = studentRowSchema.safeParse(row)
    if (!parsed.success) {
      const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] ?? 'Invalid row'
      failed.push({ matric_number: row.matric_number || '(blank)', reason: firstError })
      continue
    }

    const { matric_number, full_name, level, date_of_birth } = parsed.data

    // No unique constraint on `matric_number` at the DB level — same
    // reasoning as the email check above.
    if (await findStudentByMatric(matric_number)) {
      failed.push({ matric_number, reason: 'Already registered' })
      continue
    }

    const localPart = matric_number.toLowerCase().replace(/[^a-z0-9]/g, '')
    const email = `${localPart}@${admin.university_id}.students.pcu-cbt.internal`

    await createStudentUser({
      universityId: admin.university_id, email, fullName: full_name,
      matricNumber: matric_number, level,
      dateOfBirth: date_of_birth ? new Date(date_of_birth) : null,
      departmentId: department_id, facultyId: faculty_id,
    })
    created.push(matric_number)
  }

  revalidatePath('/admin/users')
  return { ok: true, createdCount: created.length, failed }
}

export async function toggleUserActive(userId) {
  const admin = await requireRole(...ADMIN_ROLES)
  if (userId === admin.id) return { error: 'You cannot deactivate your own account.' }

  const target = await findUserById(userId)
  if (!target) return { error: 'User not found.' }
  if (target.removed_at) return { error: 'This user has been removed and cannot be reactivated.' }

  const nextActive = !target.is_active
  await setUserActive(userId, nextActive)
  await recordAuthEvent({
    action: nextActive ? 'activated' : 'deactivated',
    actor_id: admin.id, target_user_id: userId, university_id: target.university_id,
  })

  revalidatePath('/admin/users')
  return { ok: true, is_active: nextActive }
}

export async function removeUser(userId) {
  const admin = await requireRole(...ADMIN_ROLES)
  if (userId === admin.id) return { error: 'You cannot remove your own account.' }

  const target = await findUserById(userId)
  if (!target) return { error: 'User not found.' }
  if (target.removed_at) return { error: 'This user has already been removed.' }

  await markUserRemoved(userId)
  await recordAuthEvent({
    action: 'removed', actor_id: admin.id, target_user_id: userId, university_id: target.university_id,
  })

  revalidatePath('/admin/users')
  return { ok: true }
}

// ─── Academic structure ───────────────────────────────────────────────────────

export async function createFaculty(prevState, formData) {
  const admin = await requireRole(...ADMIN_ROLES)
  const name = formData.get('name')?.trim()
  if (!name || name.length < 2) return { errors: { name: ['Faculty name must be at least 2 characters.'] } }

  try {
    await createFacultyRepo(admin.university_id, name)
  } catch (e) {
    if (isUniqueConstraintError(e)) return { errors: { name: ['A faculty with this name already exists.'] } }
    throw e
  }

  revalidatePath('/admin/structure')
  return { ok: true }
}

export async function createDepartment(prevState, formData) {
  const admin = await requireRole(...ADMIN_ROLES)
  const name       = formData.get('name')?.trim()
  const faculty_id = formData.get('faculty_id')
  if (!name || name.length < 2) return { errors: { name: ['Department name required.'] } }
  if (!faculty_id) return { errors: { faculty_id: ['Select a faculty.'] } }

  try {
    await createDepartmentRepo({ universityId: admin.university_id, facultyId: faculty_id, name })
  } catch (e) {
    if (isUniqueConstraintError(e)) return { errors: { name: ['A department with this name already exists in this faculty.'] } }
    throw e
  }

  revalidatePath('/admin/structure')
  return { ok: true }
}

const courseSchema = z.object({
  course_code:   z.string().min(2, 'Course code required').toUpperCase(),
  course_title:  z.string().min(2, 'Course title required'),
  department_id: z.string().uuid('Select a department'),
  credit_units:  z.coerce.number().int().min(1).max(6),
  level:         z.enum(['100', '200', '300', '400', '500', 'PG']),
  semester:      z.enum(['first', 'second']),
})

export async function createCourse(prevState, formData) {
  const admin = await requireRole(...ADMIN_ROLES)

  const parsed = courseSchema.safeParse({
    course_code:   formData.get('course_code')?.trim(),
    course_title:  formData.get('course_title')?.trim(),
    department_id: formData.get('department_id'),
    credit_units:  formData.get('credit_units'),
    level:         formData.get('level'),
    semester:      formData.get('semester'),
  })
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }

  try {
    await createCourseRepo({
      universityId: admin.university_id, courseCode: parsed.data.course_code, courseTitle: parsed.data.course_title,
      departmentId: parsed.data.department_id, creditUnits: parsed.data.credit_units,
      level: parsed.data.level, semester: parsed.data.semester,
    })
  } catch (e) {
    if (isUniqueConstraintError(e)) return { errors: { course_code: ['This course code already exists.'] } }
    throw e
  }

  revalidatePath('/admin/courses')
  return { ok: true }
}

// ─── Institution settings (FR-INST-1) ────────────────────────────────────────

const institutionSchema = z.object({
  name: z.string().min(3, 'Institution name required'),
  primary_color: z.string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Enter a valid hex color')
    .refine(isDarkEnoughForWhiteText, 'This color is too light for white button text to stay readable — try a darker shade.')
    .optional().or(z.literal('')),
  logo_url: z.string()
    .refine(s => /^https?:\/\//.test(s) || s.startsWith('/'), 'Enter a full URL (https://...) or a path starting with /')
    .optional().or(z.literal('')),
})

export async function updateInstitutionSettings(prevState, formData) {
  await requireRole('super_admin')

  const parsed = institutionSchema.safeParse({
    name:          formData.get('name')?.trim(),
    primary_color: formData.get('primary_color')?.trim() || '',
    logo_url:      formData.get('logo_url')?.trim() || '',
  })
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }

  await updateInstitution({
    name: parsed.data.name,
    logoUrl: parsed.data.logo_url || null,
    primaryColor: parsed.data.primary_color || null,
  })

  revalidatePath('/admin/settings')
  revalidatePath('/admin', 'layout')
  return { ok: true }
}

// ─── Lab IP allowlist (FR-LAB-1) ──────────────────────────────────────────────

const singleEntrySchema = z.object({
  entry: z.string().min(7, 'Enter an IPv4 address or CIDR range'),
  label: z.string().optional().or(z.literal('')),
})

export async function addLabIpAllowlistEntry(prevState, formData) {
  const admin = await requireRole(...ADMIN_ROLES)

  const parsed = singleEntrySchema.safeParse({
    entry: formData.get('entry')?.trim(),
    label: formData.get('label')?.trim() || '',
  })
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }
  if (!isValidEntry(parsed.data.entry)) {
    return { errors: { entry: ['Enter a valid IPv4 address or CIDR (e.g. 192.168.1.11 or 192.168.1.0/24).'] } }
  }

  await createEntry({ universityId: admin.university_id, entry: parsed.data.entry, label: parsed.data.label || null, createdBy: admin.id })
  revalidatePath('/admin/lab-network')
  return { ok: true }
}

const rangeSchema = z.object({
  start_ip: z.string(),
  end_ip: z.string(),
  label: z.string().optional().or(z.literal('')),
})

export async function addLabIpAllowlistRange(prevState, formData) {
  const admin = await requireRole(...ADMIN_ROLES)

  const parsed = rangeSchema.safeParse({
    start_ip: formData.get('start_ip')?.trim(),
    end_ip: formData.get('end_ip')?.trim(),
    label: formData.get('label')?.trim() || '',
  })
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }
  if (!isValidEntry(parsed.data.start_ip) || parsed.data.start_ip.includes('/')) {
    return { errors: { start_ip: ['Enter a plain IPv4 address, not a range.'] } }
  }
  if (!isValidEntry(parsed.data.end_ip) || parsed.data.end_ip.includes('/')) {
    return { errors: { end_ip: ['Enter a plain IPv4 address, not a range.'] } }
  }

  try {
    const created = await addRange({
      universityId: admin.university_id, startIp: parsed.data.start_ip, endIp: parsed.data.end_ip,
      label: parsed.data.label || null, createdBy: admin.id,
    })
    revalidatePath('/admin/lab-network')
    return { ok: true, count: created.length }
  } catch (e) {
    return { errors: { _form: e.message } }
  }
}

export async function toggleLabIpAllowlistEntry(entryId, isActive) {
  await requireRole(...ADMIN_ROLES)
  await setEntryActive(entryId, isActive)
  revalidatePath('/admin/lab-network')
  return { ok: true }
}
