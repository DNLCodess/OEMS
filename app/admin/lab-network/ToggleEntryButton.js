'use client'

import { useTransition } from 'react'
import { toggleLabIpAllowlistEntry } from '@/lib/actions/admin'
import { toast } from 'sonner'

export function ToggleEntryButton({ entryId, isActive }) {
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      await toggleLabIpAllowlistEntry(entryId, !isActive)
      toast.success(isActive ? 'Entry deactivated.' : 'Entry activated.')
    })
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className={[
        'text-xs font-medium px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50',
        isActive ? 'text-danger hover:bg-danger-light' : 'text-success hover:bg-success-light',
      ].join(' ')}
    >
      {pending ? '…' : isActive ? 'Deactivate' : 'Activate'}
    </button>
  )
}
