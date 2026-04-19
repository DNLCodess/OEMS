'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Play } from 'lucide-react'
import { startExam } from '@/lib/actions/attempts'

export function LabStartButton({ examId, labCode }) {
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
    router.push(`/lab/${labCode}/attempt/${result.attemptId}`)
  }

  return (
    <button
      onClick={handleStart}
      disabled={loading}
      className="inline-flex items-center gap-2.5 px-10 py-4 bg-primary text-white font-semibold rounded-2xl hover:bg-primary-hover disabled:opacity-60 transition-colors text-base"
    >
      {loading ? (
        <>
          <Loader2 size={18} className="animate-spin" />
          Starting exam…
        </>
      ) : (
        <>
          <Play size={18} />
          Begin Exam
        </>
      )}
    </button>
  )
}
