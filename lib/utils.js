export const ROLE_HOME = {
  super_admin:  '/super-admin/dashboard',
  school_admin: '/admin/dashboard',
  lecturer:     '/lecturer/dashboard',
  student:      '/lab',
}

export const EXAM_TYPE_LABELS = {
  ca:              'C.A.',
  mid_semester:    'Mid-Semester',
  end_of_semester: 'End of Semester',
}

export function stripHtml(html) {
  return html?.replace(/<[^>]*>/g, '').trim() ?? ''
}
