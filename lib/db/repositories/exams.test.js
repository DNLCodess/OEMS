import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testPrisma as prisma, resetDb, seedMinimalStructure } from '@/tests/helpers/db'
import { findExamByAccessCode, findInProgressAttempt } from './exams'

async function aLecturer(universityId) {
  return prisma.user.create({
    data: { university_id: universityId, role: 'lecturer', email: 'l@pcu.edu', full_name: 'L' },
  })
}

async function anExam(university, course, lecturer, extra = {}) {
  return prisma.exam.create({
    data: {
      university_id: university.id, created_by: lecturer.id, course_id: course.id,
      title: 'CSC 301 Mid-Semester Test', duration_minutes: 60,
      academic_session: '2025/2026', semester: 'first', exam_type: 'mid_semester',
      status: 'live', access_code: 'ABC123', ...extra,
    },
  })
}

describe('repositories/exams (entry-only)', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('findExamByAccessCode finds a live exam', async () => {
    const { university, course } = await seedMinimalStructure()
    const lecturer = await aLecturer(university.id)
    const exam = await anExam(university, course, lecturer)
    const found = await findExamByAccessCode('ABC123')
    expect(found.id).toBe(exam.id)
    expect(found.status).toBe('live')
  })

  it('findExamByAccessCode returns null for an unknown code', async () => {
    await seedMinimalStructure()
    expect(await findExamByAccessCode('ZZZZZZ')).toBeNull()
  })

  it('findExamByAccessCode exposes revocation and IP-enforcement fields', async () => {
    const { university, course } = await seedMinimalStructure()
    const lecturer = await aLecturer(university.id)
    const revokedAt = new Date()
    await anExam(university, course, lecturer, { access_code: 'DEF456', access_code_revoked_at: revokedAt, enforce_ip_allowlist: false })
    const found = await findExamByAccessCode('DEF456')
    expect(found.access_code_revoked_at.toISOString()).toBe(revokedAt.toISOString())
    expect(found.enforce_ip_allowlist).toBe(false)
  })

  it('findInProgressAttempt finds an in-progress attempt for this exam+student', async () => {
    const { university, course } = await seedMinimalStructure()
    const lecturer = await aLecturer(university.id)
    const exam = await anExam(university, course, lecturer)
    const student = await prisma.user.create({
      data: { university_id: university.id, role: 'student', email: 's@pcu.edu', full_name: 'S', matric_number: 'CSC/2021/001' },
    })
    const attempt = await prisma.attempt.create({ data: { exam_id: exam.id, student_id: student.id, status: 'in_progress' } })
    const found = await findInProgressAttempt(exam.id, student.id)
    expect(found.id).toBe(attempt.id)
  })

  it('findInProgressAttempt returns null when the attempt is already submitted', async () => {
    const { university, course } = await seedMinimalStructure()
    const lecturer = await aLecturer(university.id)
    const exam = await anExam(university, course, lecturer)
    const student = await prisma.user.create({
      data: { university_id: university.id, role: 'student', email: 's@pcu.edu', full_name: 'S', matric_number: 'CSC/2021/001' },
    })
    await prisma.attempt.create({ data: { exam_id: exam.id, student_id: student.id, status: 'submitted' } })
    expect(await findInProgressAttempt(exam.id, student.id)).toBeNull()
  })

  it('findInProgressAttempt returns null when there is no attempt at all', async () => {
    const { university, course } = await seedMinimalStructure()
    const lecturer = await aLecturer(university.id)
    const exam = await anExam(university, course, lecturer)
    const student = await prisma.user.create({
      data: { university_id: university.id, role: 'student', email: 's@pcu.edu', full_name: 'S', matric_number: 'CSC/2021/001' },
    })
    expect(await findInProgressAttempt(exam.id, student.id)).toBeNull()
  })
})
