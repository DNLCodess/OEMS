import { z } from 'zod'

export const examSettingsSchema = z.object({
  title: z
    .string()
    .min(3, 'Title must be at least 3 characters')
    .max(200, 'Title is too long'),
  course_id: z.string().uuid('Select a course'),
  exam_type: z.enum(['ca', 'mid_semester', 'end_of_semester'], {
    required_error: 'Select an exam type',
  }),
  academic_session: z
    .string()
    .regex(/^\d{4}\/\d{4}$/, 'Format: YYYY/YYYY  e.g. 2024/2025'),
  semester: z.enum(['first', 'second'], { required_error: 'Select a semester' }),
  duration_minutes: z.coerce
    .number({ invalid_type_error: 'Enter a duration' })
    .int()
    .min(5,  'Minimum duration is 5 minutes')
    .max(300, 'Maximum duration is 300 minutes'),
  entry_window_minutes: z.coerce
    .number({ invalid_type_error: 'Enter an entry window' })
    .int()
    .min(1,   'Minimum is 1 minute')
    .max(180, 'Maximum is 180 minutes'),
  pass_mark: z.coerce
    .number({ invalid_type_error: 'Enter a pass mark' })
    .int()
    .min(0,   'Minimum is 0')
    .max(100, 'Maximum is 100'),
  instructions:        z.string().optional().nullable(),
  randomise_questions: z.boolean().default(false),
  randomise_options:   z.boolean().default(false),
  // Delivery & tools
  exam_mode:           z.enum(['remote', 'lab']).default('lab'),
  proctoring_enabled:  z.boolean().default(false),
  show_calculator:     z.boolean().default(false),
  tips:                z.array(z.string().max(300)).default([]),
})

// react-hook-form's useFieldArray needs each tip to be an object with a
// stable key, not a bare string — it can't manage an array of primitives
// directly. This is the schema the form's resolver validates against; the
// component unwraps { value } objects into plain strings before sending the
// payload to createExam/updateExamSettings, which validates against
// examSettingsSchema above. Validating the raw field-array shape against
// that schema instead (string[]) would fail on every submit that has any
// tip at all, since RHF's own state never matches "array of strings."
export const examSettingsFormSchema = examSettingsSchema.extend({
  tips: z.array(z.object({
    value: z.string().max(300, 'Tip is too long'),
  })).default([]),
})
