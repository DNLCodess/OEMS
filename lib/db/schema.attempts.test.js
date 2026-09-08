import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'

async function baseline() {
  const { university, course } = await seedMinimalStructure()
  const lecturer = await prisma.user.create({
    data: { university_id: university.id, role: 'lecturer', email: 'lec@pcu.edu', full_name: 'Lec' },
  })
  const student = await prisma.user.create({
    data: { university_id: university.id, role: 'student', email: 'stu@pcu.edu', full_name: 'Stu', matric_number: 'CSC/2021/9' },
  })
  const question = await prisma.questionBank.create({
    data: { university_id: university.id, created_by: lecturer.id, course_id: course.id, type: 'mcq', body: 'q' },
  })
  const exam = await prisma.exam.create({
    data: {
      university_id: university.id, created_by: lecturer.id, course_id: course.id,
      title: 'E', duration_minutes: 30, academic_session: '2025/2026', semester: 'first', exam_type: 'ca',
    },
  })
  return { university, course, lecturer, student, question, exam }
}

describe('schema: attempts / responses / results', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('enforces one attempt per (exam, student)', async () => {
    const { exam, student } = await baseline()
    await prisma.attempt.create({ data: { exam_id: exam.id, student_id: student.id } })
    await expect(
      prisma.attempt.create({ data: { exam_id: exam.id, student_id: student.id } }),
    ).rejects.toThrow()
  })

  it('upserts a response idempotently on (attempt, question)', async () => {
    const { exam, student, question } = await baseline()
    const attempt = await prisma.attempt.create({ data: { exam_id: exam.id, student_id: student.id } })
    const key = { attempt_id_question_id: { attempt_id: attempt.id, question_id: question.id } }

    await prisma.response.upsert({
      where: key,
      create: { attempt_id: attempt.id, question_id: question.id, student_answer: JSON.stringify('a') },
      update: { student_answer: JSON.stringify('a') },
    })
    await prisma.response.upsert({
      where: key,
      create: { attempt_id: attempt.id, question_id: question.id, student_answer: JSON.stringify('b') },
      update: { student_answer: JSON.stringify('b') },
    })
    const rows = await prisma.response.findMany({ where: { attempt_id: attempt.id } })
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0].student_answer)).toBe('b')
  })

  it('cascades attempt delete to responses and result', async () => {
    const { exam, student, question } = await baseline()
    const attempt = await prisma.attempt.create({ data: { exam_id: exam.id, student_id: student.id } })
    await prisma.response.create({ data: { attempt_id: attempt.id, question_id: question.id } })
    await prisma.result.create({
      data: { attempt_id: attempt.id, student_id: student.id, exam_id: exam.id, final_score: 0, passed: false },
    })
    await prisma.attempt.delete({ where: { id: attempt.id } })
    expect(await prisma.response.count()).toBe(0)
    expect(await prisma.result.count()).toBe(0)
  })

  it('rejects an invalid attempt status', async () => {
    const { exam, student } = await baseline()
    await expect(
      prisma.attempt.create({ data: { exam_id: exam.id, student_id: student.id, status: 'cheating' } }),
    ).rejects.toThrow()
  })
})

describe('schema: admin_action_log / lab_ip_allowlist', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('logs an IP-block action with JSON meta', async () => {
    const { university } = await baseline()
    const row = await prisma.adminActionLog.create({
      data: {
        university_id: university.id, action: 'exam_entry_ip_blocked',
        target_identifier: 'CSC/2021/9', meta: JSON.stringify({ ip: '10.0.0.5' }),
      },
    })
    expect(JSON.parse(row.meta).ip).toBe('10.0.0.5')
  })

  it('rejects an unknown log action', async () => {
    await expect(
      prisma.adminActionLog.create({ data: { action: 'nuked_everything' } }),
    ).rejects.toThrow()
  })

  it('stores a CIDR allowlist entry', async () => {
    const { university, lecturer } = await baseline()
    const e = await prisma.labIpAllowlist.create({
      data: { university_id: university.id, entry: '192.168.1.0/24', label: 'Lab A', created_by: lecturer.id },
    })
    expect(e.is_active).toBe(true)
  })
})
