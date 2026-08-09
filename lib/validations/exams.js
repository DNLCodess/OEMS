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
  start_at: z.string().nullable().optional(),
  end_at:   z.string().nullable().optional(),
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
}).refine(
  data => {
    if (data.start_at && data.end_at) {
      return new Date(data.end_at) > new Date(data.start_at)
    }
    return true
  },
  { message: 'End date/time must be after start date/time', path: ['end_at'] }
)
