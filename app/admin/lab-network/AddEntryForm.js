'use client'

import { useActionState, useState } from 'react'
import { Plus, ChevronDown, ChevronUp } from 'lucide-react'
import { addLabIpAllowlistEntry } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'

export function AddEntryForm() {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(addLabIpAllowlistEntry, null)

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2"><Plus size={14} /> Add Single Entry</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <form action={formAction} className="px-4 pb-4 space-y-3 border-t border-border bg-page">
          <Input
            id="entry" name="entry" label="IP Address or CIDR"
            placeholder="192.168.1.11 or 192.168.1.0/24" required
            error={state?.errors?.entry?.[0]}
          />
          <Input id="label" name="label" label="Label (optional)" placeholder="Lab A, row 1" />
          {state?.errors?._form && <p className="text-sm text-danger">{state.errors._form}</p>}
          <SubmitButton loadingText="Adding…" className="w-full">Add Entry</SubmitButton>
        </form>
      )}
    </div>
  )
}
