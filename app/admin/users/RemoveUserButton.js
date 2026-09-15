'use client'

import { useState, useTransition } from 'react'
import { removeUser } from '@/lib/actions/admin'
import { toast } from 'sonner'

export function RemoveUserButton({ userId }) {
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)

  function handleClick() {
    if (!confirming) { setConfirming(true); return }
    startTransition(async () => {
      const result = await removeUser(userId)
      if (result?.error) toast.error(result.error)
      else toast.success('User removed.')
      setConfirming(false)
    })
  }

  return (
    <button
      onClick={handleClick}
      onBlur={() => setConfirming(false)}
      disabled={pending}
      className={[
        'text-xs font-medium px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50 ml-1',
        confirming ? 'text-white bg-danger' : 'text-danger hover:bg-danger-light',
      ].join(' ')}
    >
      {pending ? '…' : confirming ? 'Confirm?' : 'Remove'}
    </button>
  )
}
