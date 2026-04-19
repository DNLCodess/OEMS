'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { startExam } from '@/lib/actions/attempts'

export function StartExamButton({ examId }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleStart() {
    setLoading(true)
    const result = await startExam(examId)
    if (result?.error) {
      toast.error(result.error)
      setLoading(false)
      return
    }
    router.push(`/student/exams/${examId}/attempt/${result.attemptId}`)
  }

  return (
    <button
      onClick={handleStart}
      disabled={loading}
      className="inline-flex items-center gap-2.5 px-8 py-3.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-hover disabled:opacity-60 transition-colors text-sm"
    >
      {loading ? (
        <>
          <Loader2 size={16} className="animate-spin" />
          Starting exam…
        </>
      ) : (
        'Start Exam'
      )}
    </button>
  )
}
