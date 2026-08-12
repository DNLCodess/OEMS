'use client'

import { useActionState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { verifyResultAccess } from '@/lib/actions/studentAuth'

export function CheckResultForm({ universitySlug }) {
  const [state, formAction, pending] = useActionState(verifyResultAccess, null)

  return (
    <form action={formAction} className="space-y-5">
      {universitySlug && <input type="hidden" name="university_slug" value={universitySlug} />}
      <div>
        <label htmlFor="matric_number" className="block text-sm font-medium text-text-primary mb-2">
          Matric Number
        </label>
        <input
          id="matric_number"
          name="matric_number"
          type="text"
          placeholder="e.g. CSC/2021/001"
          autoComplete="off"
          required
          className="w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-sm focus:outline-none focus:border-primary transition-colors"
        />
      </div>

      <div>
        <label htmlFor="date_of_birth" className="block text-sm font-medium text-text-primary mb-2">
          Date of Birth
        </label>
        <input
          id="date_of_birth"
          name="date_of_birth"
          type="date"
          required
          className="w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-sm focus:outline-none focus:border-primary transition-colors"
        />
        {state?.error && (
          <p className="text-xs text-danger mt-2 text-center">{state.error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full flex items-center justify-center gap-2 py-3.5 bg-primary text-white text-sm font-semibold rounded-2xl hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending
          ? <><Loader2 size={16} className="animate-spin" /> Checking…</>
          : <><ArrowRight size={16} /> View My Results</>
        }
      </button>
    </form>
  )
}
