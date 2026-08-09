import { z } from 'zod'

const QUESTION_TYPES = ['mcq', 'multi_select', 'true_false', 'fill_blank']
const DIFFICULTIES    = ['easy', 'medium', 'hard']
const OPTION_RE       = /\S/  // at least one non-whitespace char

function stripHtml(html) {
  return html?.replace(/<[^>]+>/g, '').trim() ?? ''
}

export const questionSchema = z.object({
  course_id:      z.string().uuid('Please select a course'),
  type:           z.enum(QUESTION_TYPES, { required_error: 'Select a question type' }),
  difficulty:     z.enum(DIFFICULTIES,    { required_error: 'Select a difficulty' }),
  body:           z.string().min(1, 'Question body is required'),
  options:        z.array(z.object({
    id:   z.string(),
    text: z.string(),
  })).optional(),
  correct_answer: z.any().optional(),
  explanation:    z.string().optional(),
  tags:           z.string().optional(),
}).superRefine((data, ctx) => {
  // Body must contain real text, not just empty HTML tags
  const bodyText = stripHtml(data.body)
  if (bodyText.length < 5) {
    ctx.addIssue({
      code: 'custom',
      path: ['body'],
      message: 'Question body is too short — write at least a sentence',
    })
  }

  if (data.type === 'mcq' || data.type === 'multi_select') {
    const opts = data.options ?? []
    if (opts.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least 2 options' })
    }
    const emptyOption = opts.some(o => !OPTION_RE.test(o.text))
    if (emptyOption) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'All options must have text' })
    }
    if (data.type === 'mcq' && !data.correct_answer) {
      ctx.addIssue({ code: 'custom', path: ['correct_answer'], message: 'Select the correct answer' })
    }
    if (data.type === 'multi_select') {
      const ans = data.correct_answer
      if (!Array.isArray(ans) || ans.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['correct_answer'], message: 'Select at least one correct answer' })
      }
    }
  }

  if (data.type === 'true_false' && !data.correct_answer) {
    ctx.addIssue({ code: 'custom', path: ['correct_answer'], message: 'Select True or False as the correct answer' })
  }

  if (data.type === 'fill_blank') {
    const ans = typeof data.correct_answer === 'string' ? data.correct_answer.trim() : ''
    if (!ans) {
      ctx.addIssue({ code: 'custom', path: ['correct_answer'], message: 'Enter the correct answer for the blank' })
    }
  }
})
