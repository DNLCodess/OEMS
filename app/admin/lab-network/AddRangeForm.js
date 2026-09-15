'use client'

import { useActionState, useState } from 'react'
import { Plus, ChevronDown, ChevronUp } from 'lucide-react'
import { addLabIpAllowlistRange } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'

export function AddRangeForm() {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(addLabIpAllowlistRange, null)

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2"><Plus size={14} /> Add Range (bulk)</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <form action={formAction} className="px-4 pb-4 space-y-3 border-t border-border bg-page">
          <div className="grid grid-cols-2 gap-3">
            <Input id="start_ip" name="start_ip" label="Start IP" placeholder="192.168.1.11" required error={state?.errors?.start_ip?.[0]} />
            <Input id="end_ip" name="end_ip" label="End IP" placeholder="192.168.1.60" required error={state?.errors?.end_ip?.[0]} />
          </div>
          <Input id="range_label" name="label" label="Label (optional, applies to all)" placeholder="Lab A" />
          {state?.errors?._form && <p className="text-sm text-danger">{state.errors._form}</p>}
          {state?.ok && <p className="text-sm text-success">{state.count} host(s) added.</p>}
          <SubmitButton loadingText="Adding…" className="w-full">Add Range</SubmitButton>
        </form>
      )}
    </div>
  )
}
