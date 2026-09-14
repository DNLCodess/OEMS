// Entry-only. Slice 5 owns the full exams repository (create/update/list,
// access-code lifecycle management, question attachment). This file exists
// solely to support student verification (Slice 2) — do not add functions
// here that aren't needed by lib/actions/studentAuth.js or its stub pages.
import 'server-only'
import { prisma } from '@/lib/db/client'

export async function findExamByAccessCode(code) {
  return prisma.exam.findFirst({
    where: { access_code: code },
    select: {
      id: true, university_id: true, status: true, go_live_at: true,
      entry_window_minutes: true, access_code_revoked_at: true,
      enforce_ip_allowlist: true, title: true, duration_minutes: true,
    },
  })
}

export async function findInProgressAttempt(examId, studentId) {
  return prisma.attempt.findFirst({
    where: { exam_id: examId, student_id: studentId, status: 'in_progress' },
    select: { id: true },
  })
}
