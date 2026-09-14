import { notFound } from 'next/navigation'
import { findExamByAccessCode } from '@/lib/db/repositories/exams'
import { readStudentSession } from '@/lib/auth/session'
import { MatricEntryForm } from './MatricEntryForm'
import { EndSessionButton } from './EndSessionButton'
import { Monitor } from 'lucide-react'
import { BrandedPageBackground } from '@/components/shared/BrandedPageBackground'

export const metadata = { title: 'Exam — PCU CBT Lab' }

export default async function LabLobbyPage({ params }) {
  const { code } = await params
  const upperCode = code.toUpperCase()

  const session = await readStudentSession()
  const isAuthedForThisExam = session?.channel === 'exam_access'

  if (!isAuthedForThisExam) {
    return (
      <BrandedPageBackground>
        <div className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-sm">
            <div className="flex items-center justify-center gap-2 mb-6">
              <span className="flex items-center gap-1.5 bg-primary text-white text-xs font-semibold px-3 py-1.5 rounded-full">
                <Monitor size={12} />
                Lab Session · Code: {upperCode}
              </span>
            </div>
            <MatricEntryForm code={upperCode} />
          </div>
        </div>
      </BrandedPageBackground>
    )
  }

  const exam = await findExamByAccessCode(upperCode)
  if (!exam || exam.id !== session.verifiedExamId) notFound()

  return (
    <BrandedPageBackground>
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm text-center">
          <Monitor size={48} className="mx-auto mb-4 text-text-muted" />
          <h1 className="text-xl font-bold text-text-primary mb-2">{exam.title}</h1>
          <p className="text-sm text-text-secondary mb-1">Duration: {exam.duration_minutes} minutes</p>
          <p className="text-sm text-text-muted mb-6">
            You&apos;re verified for this exam. Your exam will begin shortly — wait for your invigilator.
          </p>
          <EndSessionButton code={upperCode} />
        </div>
      </div>
    </BrandedPageBackground>
  )
}
