'use client'

import { useState, useTransition } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { superAdminToggleUserActive, superAdminRemoveUser } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

export function SuperAdminUserActions({ userId, userName, isActive }) {
  const [pending, startTransition] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  function handleToggle() {
    startTransition(async () => {
      const result = await superAdminToggleUserActive(userId)
      if (result?.error) toast.error(result.error)
      else toast.success(result.is_active ? 'User activated.' : 'User deactivated.')
    })
  }

  function handleRemove() {
    startTransition(async () => {
      const result = await superAdminRemoveUser(userId)
      if (result?.error) toast.error(result.error)
      else {
        toast.success('User removed.')
        setConfirmOpen(false)
      }
    })
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={handleToggle}
        disabled={pending}
        className={[
          'text-xs font-medium px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50',
          isActive ? 'text-danger hover:bg-danger-light' : 'text-success hover:bg-success-light',
        ].join(' ')}
      >
        {pending ? '…' : isActive ? 'Deactivate' : 'Activate'}
      </button>
      <button
        onClick={() => setConfirmOpen(true)}
        disabled={pending}
        className="text-xs font-medium px-2.5 py-1 rounded-lg text-danger hover:bg-danger-light transition-colors disabled:opacity-50"
      >
        Remove
      </button>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-text-primary">Remove {userName}</h2>
              <button
                onClick={() => setConfirmOpen(false)}
                className="p-1.5 rounded text-text-muted hover:text-text-primary"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-text-secondary mb-4">
              This permanently removes {userName}&rsquo;s access. This cannot be undone from the app. Type their name to confirm.
            </p>
            <Input
              id="confirm-name"
              label={`Type "${userName}" to confirm`}
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={userName}
            />
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleRemove}
                loading={pending}
                disabled={confirmText !== userName}
              >
                Remove user
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
