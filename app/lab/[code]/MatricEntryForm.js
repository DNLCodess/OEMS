'use client'

import { useActionState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { verifyExamAccess } from '@/lib/actions/studentAuth'

export function MatricEntryForm({ code }) {
  const [state, formAction, isPending] = useActionState(verifyExamAccess, null)

  return (
    <form action={formAction} className="space-y-5">
      {/* The code is already known from the URL this machine was
          pre-loaded to — the student only ever types their matric number. */}
      <input type="hidden" name="access_code" value={code} />

      <div>
        <label htmlFor="matric_number" className="block text-sm font-medium text-text-primary mb-2 text-center">
          Enter your Matric Number to begin
        </label>
        <input
          id="matric_number"
          name="matric_number"
          type="text"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. CSC/2021/001"
          className="w-full text-center text-lg font-mono font-semibold rounded-2xl border-2 border-border focus:border-primary px-4 py-4 focus:outline-none transition-colors text-text-primary"
        />
        {state?.error && (
          <p className="text-xs text-danger mt-2 text-center">{state.error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full flex items-center justify-center gap-2 py-3.5 bg-primary text-white text-sm font-semibold rounded-2xl hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isPending
          ? <><Loader2 size={16} className="animate-spin" /> Verifying…</>
          : <><ArrowRight size={16} /> Enter Exam</>
        }
      </button>
    </form>
  )
}
