'use client'

import { X } from 'lucide-react'

export function DraftBanner({ onDiscard, onDismiss }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-primary-light border border-primary/20 rounded-lg px-3 py-2.5 mb-6">
      <p className="text-xs text-primary/80">
        Draft restored from your last session.{' '}
        <button
          type="button"
          onClick={onDiscard}
          className="font-medium underline hover:no-underline"
        >
          Discard draft
        </button>
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-primary/60 hover:text-primary"
      >
        <X size={14} />
      </button>
    </div>
  )
}
