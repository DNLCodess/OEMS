'use client'

import { useActionState, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { verifyExamAccess } from '@/lib/actions/studentAuth'

export function LabCodeEntry() {
  const [state, formAction, pending] = useActionState(verifyExamAccess, null)
  const [code, setCode] = useState('')

  function handleCodeChange(e) {
    setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
  }

  return (
    <form action={formAction} className="space-y-5">
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
        <label htmlFor="access_code" className="block text-sm font-medium text-text-primary mb-2 text-center">
          Access Code
        </label>
        <input
          id="access_code"
          name="access_code"
          type="text"
          value={code}
          onChange={handleCodeChange}
          placeholder="e.g. ABC123"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          className={[
            'w-full text-center text-3xl font-mono font-bold tracking-[0.35em] uppercase',
            'rounded-2xl border-2 bg-surface px-4 py-5 focus:outline-none transition-colors',
            state?.error
              ? 'border-danger text-danger'
              : 'border-border focus:border-primary text-text-primary',
          ].join(' ')}
          maxLength={6}
        />
        {state?.error && (
          <p className="text-xs text-danger mt-2 text-center">{state.error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={code.length !== 6 || pending}
        className="w-full flex items-center justify-center gap-2 py-3.5 bg-primary text-white text-sm font-semibold rounded-2xl hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending
          ? <><Loader2 size={16} className="animate-spin" /> Verifying…</>
          : <><ArrowRight size={16} /> Enter Exam</>
        }
      </button>

      <p className="text-center text-xs text-text-muted">
        The access code is shared by your lecturer or exam officer.
      </p>
    </form>
  )
}
