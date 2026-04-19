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
  role:          z.enum(['lecturer', 'student', 'school_admin']),
  matric_number: z.string().optional(),
  level:         z.enum(['100', '200', '300', '400', '500', 'PG']).optional(),
  department_id: z.string().uuid().optional().or(z.literal('')),
  faculty_id:    z.string().uuid().optional().or(z.literal('')),
})

export async function inviteUser(prevState, formData) {
  const user = await requireRole('school_admin', 'super_admin')

  const raw = {
    email:         formData.get('email')?.trim(),
    full_name:     formData.get('full_name')?.trim(),
    role:          formData.get('role'),
    matric_number: formData.get('matric_number')?.trim() || undefined,
    level:         formData.get('level') || undefined,
    department_id: formData.get('department_id') || undefined,
    faculty_id:    formData.get('faculty_id') || undefined,
  }

  const parsed = inviteSchema.safeParse(raw)
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors }
  }

  const { email, full_name, role, matric_number, level, department_id, faculty_id } = parsed.data

  if (role === 'student' && !matric_number) {
    return { errors: { matric_number: ['Matric number is required for students.'] } }
  }

  const adminClient = createAdminClient()

  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password: 'ChangeMe123!',   // temporary password — user should reset via forgot-password
    email_confirm: true,
    user_metadata: {
      full_name,
      role,
      university_id: user.university_id,
      matric_number: matric_number || null,
      level:         level || null,
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

export async function toggleUserActive(userId) {
  const user = await requireRole('school_admin', 'super_admin')
  const supabase = await createClient()

  // Fetch current state (also verifies university scope)
  const { data: target } = await supabase
    .from('users')
    .select('id, is_active, university_id')
    .eq('id', userId)
    .eq('university_id', user.university_id)
    .single()

  if (!target) return { error: 'User not found.' }
  if (target.id === user.id) return { error: 'You cannot deactivate your own account.' }

  const { error } = await supabase
    .from('users')
    .update({ is_active: !target.is_active })
    .eq('id', userId)

  if (error) return { error: error.message }

  revalidatePath('/admin/users')
  return { ok: true, is_active: !target.is_active }
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
  await requireRole('super_admin')
  const adminClient = createAdminClient()

  const { data: target } = await adminClient
    .from('users')
    .select('id, is_active')
    .eq('id', userId)
    .single()

  if (!target) return { error: 'User not found.' }

  const { error } = await adminClient
    .from('users')
    .update({ is_active: !target.is_active })
    .eq('id', userId)

  if (error) return { error: error.message }

  revalidatePath('/super-admin/users')
  return { ok: true, is_active: !target.is_active }
}
