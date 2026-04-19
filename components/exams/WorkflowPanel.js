'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { updateExamStatus } from '@/lib/actions/exams'
import { Badge } from '@/components/ui/Badge'
import { AlertCircle, CheckCircle2, Radio, Archive } from 'lucide-react'

const STATUS_ICON = {
  draft:     AlertCircle,
  scheduled: CheckCircle2,
  live:      Radio,
  closed:    Archive,
}

const TRANSITIONS = {
  draft:     [{ to: 'scheduled', label: 'Schedule Exam',    variant: 'primary',  confirm: false }],
  scheduled: [
    { to: 'draft', label: 'Revert to Draft', variant: 'secondary', confirm: true,
      message: 'This will unschedule the exam. Students will no longer see it.' },
    { to: 'live',  label: 'Go Live Now',     variant: 'success',   confirm: true,
      message: 'Students will be able to start the exam immediately. This cannot be undone.' },
  ],
  live:      [{ to: 'closed', label: 'Close Exam', variant: 'danger', confirm: true,
    message: 'Closing the exam stops all ongoing attempts. Remaining time is forfeited. This cannot be undone.' }],
  closed:    [],
}

const BUTTON_STYLES = {
  primary:   'bg-primary text-white hover:bg-primary-hover',
  secondary: 'bg-surface border border-border text-text-primary hover:bg-slate-50',
  success:   'bg-success text-white hover:bg-green-700',
  danger:    'bg-danger text-white hover:bg-red-700',
}

const STATUS_DESCRIPTIONS = {
  draft:     'Exam is in draft. Add questions, configure settings, then schedule when ready.',
  scheduled: 'Exam is scheduled. Students will see it in their lobby. Activate when the sitting begins.',
  live:      'Exam is live. Students can start now. Close it when the allotted time is up.',
  closed:    'Exam is closed. No further attempts can be made. You may now release results.',
}

export function WorkflowPanel({ examId, currentStatus }) {
  const router = useRouter()
  const [loading, setLoading]   = useState(false)
  const [confirm, setConfirm]   = useState(null) // { to, label, message }

  const Icon = STATUS_ICON[currentStatus] ?? AlertCircle
  const actions = TRANSITIONS[currentStatus] ?? []

  async function execute(to) {
    setLoading(true)
    setConfirm(null)
    const result = await updateExamStatus(examId, to)
    setLoading(false)

    if (result?.error) {
      toast.error(result.error)
      return
    }

    toast.success(`Exam status updated to ${to}.`)
    router.refresh()
  }

  function handleClick(action) {
    if (action.confirm) {
      setConfirm(action)
    } else {
      execute(action.to)
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5 space-y-4">
      {/* Current status */}
      <div className="flex items-center gap-2.5">
        <Icon size={18} className="text-text-secondary shrink-0" />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium text-text-primary">Status</span>
            <Badge variant={currentStatus} />
          </div>
          <p className="text-xs text-text-muted leading-relaxed">{STATUS_DESCRIPTIONS[currentStatus]}</p>
        </div>
      </div>

      {/* Transition buttons */}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {actions.map(action => (
            <button
              key={action.to}
              onClick={() => handleClick(action)}
              disabled={loading}
              className={[
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60',
                BUTTON_STYLES[action.variant],
              ].join(' ')}
            >
              {loading ? 'Updating…' : action.label}
            </button>
          ))}
        </div>
      )}

      {/* Confirmation dialog */}
      {confirm && (
        <div className="border border-warning/30 bg-warning-light rounded-lg p-4 space-y-3">
          <p className="text-sm text-text-primary font-medium">Are you sure?</p>
          <p className="text-sm text-text-secondary">{confirm.message}</p>
          <div className="flex gap-2">
            <button
              onClick={() => execute(confirm.to)}
              disabled={loading}
              className="px-4 py-1.5 bg-danger text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-60 transition-colors"
            >
              {loading ? 'Updating…' : 'Yes, continue'}
            </button>
            <button
              onClick={() => setConfirm(null)}
              className="px-4 py-1.5 bg-surface border border-border text-text-primary text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
