import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'

async function baseline() {
  const { university, course } = await seedMinimalStructure()
  const lecturer = await prisma.user.create({
    data: { university_id: university.id, role: 'lecturer', email: 'lec@pcu.edu', full_name: 'Lec' },
  })
  return { university, course, lecturer }
}

describe('schema: question_bank / exams / exam_questions / exam_access', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('stores a question with JSON string columns verbatim', async () => {
    const { university, course, lecturer } = await baseline()
    const q = await prisma.questionBank.create({
      data: {
        university_id: university.id, created_by: lecturer.id, course_id: course.id,
        type: 'mcq', body: '2+2?',
        options: JSON.stringify([{ id: 'a', text: '3' }, { id: 'b', text: '4' }]),
        correct_answer: JSON.stringify('b'),
        tags: JSON.stringify(['math']),
      },
    })
    expect(JSON.parse(q.options)).toHaveLength(2)
    expect(JSON.parse(q.correct_answer)).toBe('b')
  })

  it('rejects an invalid question type', async () => {
    const { university, course, lecturer } = await baseline()
    await expect(
      prisma.questionBank.create({
        data: {
          university_id: university.id, created_by: lecturer.id, course_id: course.id,
          type: 'freeform', body: 'x',
        },
      }),
    ).rejects.toThrow()
  })

  it('creates an exam with lab-only defaults', async () => {
    const { university, course, lecturer } = await baseline()
    const exam = await prisma.exam.create({
      data: {
        university_id: university.id, created_by: lecturer.id, course_id: course.id,
        title: 'Midterm', duration_minutes: 60,
        academic_session: '2025/2026', semester: 'first', exam_type: 'ca',
      },
    })
    expect(exam.status).toBe('draft')
    expect(exam.enforce_ip_allowlist).toBe(true)
    expect(exam.access_code_mode).toBe('auto')
    expect(exam.proctoring_enabled).toBe(false)
  })

  it('allows many NULL access codes but blocks duplicate active codes', async () => {
    const { university, course, lecturer } = await baseline()
    const mk = (title, code) => prisma.exam.create({
      data: {
        university_id: university.id, created_by: lecturer.id, course_id: course.id,
        title, duration_minutes: 60, academic_session: '2025/2026',
        semester: 'first', exam_type: 'ca', access_code: code,
      },
    })
    await mk('A', null)
    await mk('B', null)              // two NULLs OK
    await mk('C', 'ABC234')
    await expect(mk('D', 'ABC234')).rejects.toThrow()   // duplicate active code
  })

  it('lets a revoked code be reused by another exam', async () => {
    const { university, course, lecturer } = await baseline()
    const first = await prisma.exam.create({
      data: {
        university_id: university.id, created_by: lecturer.id, course_id: course.id,
        title: 'A', duration_minutes: 60, academic_session: '2025/2026',
        semester: 'first', exam_type: 'ca', access_code: 'XYZ234',
      },
    })
    await prisma.exam.update({ where: { id: first.id }, data: { access_code_revoked_at: new Date() } })
    await expect(
      prisma.exam.create({
        data: {
          university_id: university.id, created_by: lecturer.id, course_id: course.id,
          title: 'B', duration_minutes: 60, academic_session: '2025/2026',
          semester: 'first', exam_type: 'ca', access_code: 'XYZ234',
        },
      }),
    ).resolves.toBeTruthy()
  })

  it('cascades exam delete to exam_questions and exam_access', async () => {
    const { university, course, lecturer } = await baseline()
    const student = await prisma.user.create({
      data: { university_id: university.id, role: 'student', email: 'stu@pcu.edu', full_name: 'Stu', matric_number: 'X/1' },
    })
    const q = await prisma.questionBank.create({
      data: { university_id: university.id, created_by: lecturer.id, course_id: course.id, type: 'mcq', body: 'q' },
    })
    const exam = await prisma.exam.create({
      data: {
        university_id: university.id, created_by: lecturer.id, course_id: course.id,
        title: 'E', duration_minutes: 30, academic_session: '2025/2026', semester: 'first', exam_type: 'ca',
      },
    })
    await prisma.examQuestion.create({ data: { exam_id: exam.id, question_id: q.id, marks: 2 } })
    await prisma.examAccess.create({ data: { exam_id: exam.id, user_id: student.id } })

    await prisma.exam.delete({ where: { id: exam.id } })
    expect(await prisma.examQuestion.count()).toBe(0)
    expect(await prisma.examAccess.count()).toBe(0)
  })
})
