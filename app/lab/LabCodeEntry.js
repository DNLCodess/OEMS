'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Loader2 } from 'lucide-react'

export function LabCodeEntry() {
  const router = useRouter()
  const [code,    setCode]    = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  function handleChange(e) {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    setCode(val)
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (code.length !== 6) { setError('Code must be 6 characters.'); return }
    setLoading(true)
    router.push(`/lab/${code}`)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="lab-code" className="block text-sm font-medium text-text-primary mb-2 text-center">
          Lab Code
        </label>
        <input
          ref={inputRef}
          id="lab-code"
          type="text"
          value={code}
          onChange={handleChange}
          placeholder="e.g. ABC123"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          className={[
            'w-full text-center text-3xl font-mono font-bold tracking-[0.35em] uppercase',
            'rounded-2xl border-2 bg-surface px-4 py-5 focus:outline-none transition-colors',
            error
              ? 'border-danger text-danger'
              : 'border-border focus:border-primary text-text-primary',
          ].join(' ')}
          maxLength={6}
        />
        {error && (
          <p className="text-xs text-danger mt-2 text-center">{error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={code.length !== 6 || loading}
        className="w-full flex items-center justify-center gap-2 py-3.5 bg-primary text-white text-sm font-semibold rounded-2xl hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading
          ? <><Loader2 size={16} className="animate-spin" /> Opening exam…</>
          : <><ArrowRight size={16} /> Enter Exam</>
        }
      </button>

      <p className="text-center text-xs text-text-muted">
        The code is displayed by your lecturer or on the lab projector.
      </p>
    </form>
  )
}
