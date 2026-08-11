'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/dal'
import { z } from 'zod'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function revalidateAdmin() {
  revalidatePath('/admin/users')
  revalidatePath('/admin/structure')
  revalidatePath('/admin/courses')
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
  const user = await requireRole('school_admin', 'super_admin')

  const raw = {
    email:         formData.get('email')?.trim(),
    full_name:     formData.get('full_name')?.trim(),
    role:          formData.get('role'),
    department_id: formData.get('department_id') || undefined,
    faculty_id:    formData.get('faculty_id') || undefined,
  }

  const parsed = inviteSchema.safeParse(raw)
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors }
  }

  const { email, full_name, role, department_id, faculty_id } = parsed.data

  const adminClient = createAdminClient()

  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password: 'ChangeMe123!',   // temporary password — user should reset via forgot-password
    email_confirm: true,
    user_metadata: {
      full_name,
      role,
      university_id: user.university_id,
      matric_number: null,
      level:         null,
    },
  })

  if (authError) {
    if (authError.message.includes('already registered')) {
      return { errors: { email: ['This email is already registered.'] } }
    }
    return { errors: { _form: authError.message } }
  }

  // Update department/faculty since the trigger doesn't set those
  if ((department_id || faculty_id) && authData.user?.id) {
    const supabase = await createClient()
    await supabase
      .from('users')
      .update({
        department_id: department_id || null,
        faculty_id:    faculty_id    || null,
      })
      .eq('id', authData.user.id)
  }

  revalidatePath('/admin/users')
  return { ok: true, email }
}

// ─── Bulk student roster upload ───────────────────────────────────────────────

const studentRowSchema = z.object({
  // Normalized to uppercase so matric-number matching at verification time
  // (lib/actions/studentAuth.js) doesn't depend on how the exam officer
  // happened to paste it into the roster.
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

// Students never get a password — no `password` field is passed to
// createUser at all. They authenticate later via matric number + a
// per-exam access code (lib/actions/studentAuth.js), never via this email.
export async function bulkUploadStudents(prevState, formData) {
  const user         = await requireRole('school_admin', 'super_admin')
  const rosterText    = formData.get('roster') ?? ''
  const department_id = formData.get('department_id') || undefined
  const faculty_id     = formData.get('faculty_id') || undefined

  const rows = parseRosterText(rosterText)
  if (rows.length === 0) {
    return { errors: { _form: 'Paste at least one student row (matric number, full name, level).' } }
  }

  const adminClient = createAdminClient()
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
    const localPart = matric_number.toLowerCase().replace(/[^a-z0-9]/g, '')
    const email = `${localPart}@${user.university_id}.students.oems.internal`

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        full_name,
        role: 'student',
        university_id: user.university_id,
        matric_number,
        level,
        date_of_birth: date_of_birth || null,
      },
    })

    if (authError) {
      failed.push({
        matric_number,
        reason: authError.message.includes('already registered') ? 'Already registered' : authError.message,
      })
      continue
    }

    if ((department_id || faculty_id) && authData.user?.id) {
      const supabase = await createClient()
      await supabase
        .from('users')
        .update({ department_id: department_id || null, faculty_id: faculty_id || null })
        .eq('id', authData.user.id)
    }

    created.push(matric_number)
  }

  revalidatePath('/admin/users')
  return { ok: true, createdCount: created.length, failed }
}

export async function toggleUserActive(userId) {
  const user = await requireRole('school_admin', 'super_admin')
  const supabase = await createClient()

  // Fetch current state (also verifies university scope)
  const { data: target } = await supabase
    .from('users')
    .select('id, is_active, removed_at, university_id')
    .eq('id', userId)
    .eq('university_id', user.university_id)
    .single()

  if (!target) return { error: 'User not found.' }
  if (target.id === user.id) return { error: 'You cannot deactivate your own account.' }
  if (target.removed_at) return { error: 'This user has been removed and cannot be reactivated.' }

  const nextActive = !target.is_active

  const { error } = await supabase
    .from('users')
    .update({ is_active: nextActive })
    .eq('id', userId)

  if (error) return { error: error.message }

  const { error: logError } = await supabase
    .from('admin_action_log')
    .insert({
      university_id:  target.university_id,
      actor_id:       user.id,
      action:         nextActive ? 'activated' : 'deactivated',
      target_user_id: userId,
    })
  if (logError) console.error('[toggleUserActive] log insert failed', logError.message)

  revalidatePath('/admin/users')
  return { ok: true, is_active: nextActive }
}

// ─── Academic structure ───────────────────────────────────────────────────────

export async function createFaculty(prevState, formData) {
  const user = await requireRole('school_admin', 'super_admin')
  const name = formData.get('name')?.trim()

  if (!name || name.length < 2) {
    return { errors: { name: ['Faculty name must be at least 2 characters.'] } }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('faculties')
    .insert({ university_id: user.university_id, name })

  if (error) {
    if (error.code === '23505') return { errors: { name: ['A faculty with this name already exists.'] } }
    return { errors: { _form: error.message } }
  }

  revalidatePath('/admin/structure')
  return { ok: true }
}

export async function createDepartment(prevState, formData) {
  const user = await requireRole('school_admin', 'super_admin')
  const name       = formData.get('name')?.trim()
  const faculty_id = formData.get('faculty_id')

  if (!name || name.length < 2) return { errors: { name: ['Department name required.'] } }
  if (!faculty_id) return { errors: { faculty_id: ['Select a faculty.'] } }

  const supabase = await createClient()
  const { error } = await supabase
    .from('departments')
    .insert({ university_id: user.university_id, faculty_id, name })

  if (error) {
    if (error.code === '23505') return { errors: { name: ['A department with this name already exists in this faculty.'] } }
    return { errors: { _form: error.message } }
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
  const user = await requireRole('school_admin', 'super_admin')

  const raw = {
    course_code:   formData.get('course_code')?.trim(),
    course_title:  formData.get('course_title')?.trim(),
    department_id: formData.get('department_id'),
    credit_units:  formData.get('credit_units'),
    level:         formData.get('level'),
    semester:      formData.get('semester'),
  }

  const parsed = courseSchema.safeParse(raw)
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { error } = await supabase
    .from('courses')
    .insert({ university_id: user.university_id, ...parsed.data })

  if (error) {
    if (error.code === '23505') return { errors: { course_code: ['This course code already exists.'] } }
    return { errors: { _form: error.message } }
  }

  revalidatePath('/admin/courses')
  return { ok: true }
}

// ─── Super-admin: university management ──────────────────────────────────────

const universitySchema = z.object({
  name:      z.string().min(3, 'University name required'),
  subdomain: z.string().min(2, 'Subdomain required').regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, hyphens'),
})

export async function createUniversity(prevState, formData) {
  await requireRole('super_admin')

  const raw = {
    name:      formData.get('name')?.trim(),
    subdomain: formData.get('subdomain')?.trim().toLowerCase(),
  }

  const parsed = universitySchema.safeParse(raw)
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { error } = await supabase
    .from('universities')
    .insert(parsed.data)

  if (error) {
    if (error.code === '23505') return { errors: { subdomain: ['This subdomain is already taken.'] } }
    return { errors: { _form: error.message } }
  }

  revalidatePath('/super-admin/universities')
  return { ok: true }
}

export async function superAdminToggleUserActive(userId) {
  const user = await requireRole('super_admin')
  const adminClient = createAdminClient()

  const { data: target } = await adminClient
    .from('users')
    .select('id, is_active, removed_at, university_id')
    .eq('id', userId)
    .single()

  if (!target) return { error: 'User not found.' }
  if (target.id === user.id) return { error: 'You cannot deactivate your own account.' }
  if (target.removed_at) return { error: 'This user has been removed and cannot be reactivated.' }

  const nextActive = !target.is_active

  const { error } = await adminClient
    .from('users')
    .update({ is_active: nextActive })
    .eq('id', userId)

  if (error) return { error: error.message }

  const { error: logError } = await adminClient
    .from('admin_action_log')
    .insert({
      university_id:  target.university_id,
      actor_id:       user.id,
      action:         nextActive ? 'activated' : 'deactivated',
      target_user_id: userId,
    })
  if (logError) console.error('[superAdminToggleUserActive] log insert failed', logError.message)

  revalidatePath('/super-admin/users')
  return { ok: true, is_active: nextActive }
}

export async function superAdminRemoveUser(userId) {
  const user = await requireRole('super_admin')
  const adminClient = createAdminClient()

  const { data: target } = await adminClient
    .from('users')
    .select('id, removed_at, university_id')
    .eq('id', userId)
    .single()

  if (!target) return { error: 'User not found.' }
  if (target.id === user.id) return { error: 'You cannot remove your own account.' }
  if (target.removed_at) return { error: 'This user has already been removed.' }

  const { error } = await adminClient
    .from('users')
    .update({ is_active: false, removed_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) return { error: error.message }

  const { error: logError } = await adminClient
    .from('admin_action_log')
    .insert({
      university_id:  target.university_id,
      actor_id:       user.id,
      action:         'removed',
      target_user_id: userId,
    })
  if (logError) console.error('[superAdminRemoveUser] log insert failed', logError.message)

  revalidatePath('/super-admin/users')
  return { ok: true }
}
