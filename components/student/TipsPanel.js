'use client'

import { X, Lightbulb } from 'lucide-react'

export function TipsPanel({ tips, onClose }) {
  return (
    <div className="fixed inset-y-0 right-0 z-40 flex flex-col w-80 max-w-full bg-surface border-l border-border shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-amber-50">
        <div className="flex items-center gap-2">
          <Lightbulb size={16} className="text-amber-600" />
          <h2 className="text-sm font-semibold text-amber-800">Exam Tips</h2>
        </div>
        <button
          onClick={onClose}
          className="text-amber-600 hover:text-amber-900 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tips list */}
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {tips.length === 0 && (
          <p className="text-sm text-text-muted">No tips provided for this exam.</p>
        )}
        {tips.map((tip, i) => (
          <div
            key={i}
            className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3.5"
          >
            <span className="shrink-0 size-5 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center text-xs font-bold">
              {i + 1}
            </span>
            <p className="text-sm text-text-primary leading-relaxed">{tip}</p>
          </div>
        ))}
      </div>

      <div className="px-5 py-3 border-t border-border bg-slate-50">
        <p className="text-xs text-text-muted">
          Tips are for guidance only — use your own judgment.
        </p>
      </div>
    </div>
  )
}
