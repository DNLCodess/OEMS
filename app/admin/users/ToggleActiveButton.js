'use client'

import { useTransition } from 'react'
import { toggleUserActive } from '@/lib/actions/admin'
import { toast } from 'sonner'

export function ToggleActiveButton({ userId, isActive }) {
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      const result = await toggleUserActive(userId)
      if (result?.error) toast.error(result.error)
      else toast.success(result.is_active ? 'User activated.' : 'User deactivated.')
    })
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className={[
        'text-xs font-medium px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50',
        isActive
          ? 'text-danger hover:bg-danger-light'
          : 'text-success hover:bg-success-light',
      ].join(' ')}
    >
      {pending ? '…' : isActive ? 'Deactivate' : 'Activate'}
    </button>
  )
}
