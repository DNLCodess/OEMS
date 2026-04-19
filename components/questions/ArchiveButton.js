'use client'

import { useState, useTransition } from 'react'
import { Archive, AlertTriangle, X } from 'lucide-react'
import { archiveQuestion } from '@/lib/actions/questions'
import { toast } from 'sonner'

export function ArchiveButton({ questionId }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleConfirm() {
    startTransition(async () => {
      const result = await archiveQuestion(questionId)
      if (result?.error) {
        toast.error(result.error)
      } else {
        toast.success('Question archived.')
      }
      setOpen(false)
    })
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-text-muted hover:bg-danger-light hover:text-danger transition-colors"
      >
        <Archive className="size-3" />
        Archive
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-start gap-3 mb-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning-light">
                <AlertTriangle size={16} className="text-warning" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-text-primary">Archive question?</h2>
                <p className="text-sm text-text-secondary mt-1">
                  This question will be hidden from your question bank. It will be removed from any future exams but existing exam results are unaffected.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleConfirm}
                disabled={pending}
                className="flex-1 py-2.5 bg-danger text-white text-sm font-medium rounded-xl hover:bg-danger/90 disabled:opacity-60 transition-colors"
              >
                {pending ? 'Archiving…' : 'Archive'}
              </button>
              <button
                onClick={() => setOpen(false)}
                disabled={pending}
                className="flex-1 py-2.5 border border-border text-text-primary text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
