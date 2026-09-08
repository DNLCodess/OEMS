// Enum-like column values. SQL Server + Prisma has no native enum, so these
// are plain constants: enforced at the DB by CHECK constraints (see the
// _enum_checks migration) and at the edge by Zod schemas (Slice 4+).

export const USER_ROLES = Object.freeze(['super_admin', 'school_admin', 'lecturer', 'student'])
export const STUDENT_LEVELS = Object.freeze(['100', '200', '300', '400', '500', 'PG'])
export const SEMESTERS = Object.freeze(['first', 'second'])
export const EXAM_TYPES = Object.freeze(['ca', 'mid_semester', 'end_of_semester'])
export const EXAM_STATUSES = Object.freeze(['draft', 'scheduled', 'live', 'closed'])
export const QUESTION_TYPES = Object.freeze(['mcq', 'multi_select', 'true_false', 'fill_blank', 'short_answer', 'essay'])
export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard'])
export const ATTEMPT_STATUSES = Object.freeze(['in_progress', 'submitted', 'graded'])
export const SESSION_CHANNELS = Object.freeze(['password', 'exam_access', 'result_lookup'])
export const ACCESS_CODE_MODES = Object.freeze(['auto', 'manual'])
export const ADMIN_LOG_ACTIONS = Object.freeze([
  'activated', 'deactivated', 'removed',
  'logged_in', 'logged_out', 'login_failed',
  'exam_entry_ip_blocked',
])

export const ENUM_VALUES = Object.freeze({
  'users.role': USER_ROLES,
  'users.level': STUDENT_LEVELS,
  'courses.level': STUDENT_LEVELS,
  'courses.semester': SEMESTERS,
  'exams.semester': SEMESTERS,
  'exams.exam_type': EXAM_TYPES,
  'exams.status': EXAM_STATUSES,
  'exams.access_code_mode': ACCESS_CODE_MODES,
  'question_bank.type': QUESTION_TYPES,
  'question_bank.difficulty': DIFFICULTIES,
  'attempts.status': ATTEMPT_STATUSES,
  'sessions.channel': SESSION_CHANNELS,
  'admin_action_log.action': ADMIN_LOG_ACTIONS,
})
