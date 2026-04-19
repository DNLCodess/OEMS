'use client'

import { Clock } from 'lucide-react'

function pad(n) {
  return String(n).padStart(2, '0')
}

function format(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}

export function ExamTimer({ timeRemaining }) {
  const isLow    = timeRemaining <= 180  // under 3 min
  const isWarning = timeRemaining <= 600  // under 10 min

  const colorClass = isLow
    ? 'text-danger bg-danger-light'
    : isWarning
    ? 'text-warning bg-warning-light'
    : 'text-text-secondary bg-slate-100'

  const pulseClass = isLow
    ? 'animate-[pulse_0.8s_ease-in-out_infinite]'
    : isWarning
    ? 'animate-pulse'
    : ''

  return (
    <div className={`flex items-center gap-2 px-4 py-3 rounded-xl ${colorClass} ${pulseClass}`}>
      <Clock size={15} className="shrink-0" />
      <span className="font-mono text-lg font-semibold tabular-nums tracking-tight">
        {format(timeRemaining)}
      </span>
      {isLow && (
        <span className="text-xs font-medium ml-auto">Time almost up!</span>
      )}
    </div>
  )
}
