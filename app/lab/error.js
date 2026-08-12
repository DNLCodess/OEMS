'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'

export default function LabError({ error, reset }) {
  useEffect(() => {
    console.error('[LabPortal]', error)
  }, [error])

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-danger-light mb-4">
          <AlertTriangle className="size-7 text-danger" />
        </span>
        <h1 className="text-base font-semibold text-text-primary mb-1">Something went wrong</h1>
        <p className="text-sm text-text-secondary mb-6">
          An unexpected error occurred. Please try again.
        </p>
        <button
          onClick={() => reset()}
          className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
