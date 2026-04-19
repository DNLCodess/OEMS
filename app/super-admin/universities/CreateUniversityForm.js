'use client'

import { useActionState, useState } from 'react'
import { Plus, ChevronDown, ChevronUp } from 'lucide-react'
import { createUniversity } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'

export function CreateUniversityForm() {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(createUniversity, null)

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-surface">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2"><Plus size={14} /> Add University</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <form action={formAction} className="px-4 pb-4 space-y-3 border-t border-border bg-page">
          <Input
            id="uni_name" name="name" label="University Name"
            placeholder="University of Lagos" required
            error={state?.errors?.name?.[0]}
          />
          <Input
            id="subdomain" name="subdomain" label="Subdomain"
            placeholder="unilag"
            hint="Lowercase letters, numbers, hyphens only — e.g. unilag, ui, abu"
            required
            error={state?.errors?.subdomain?.[0]}
          />
          {state?.errors?._form && <p className="text-sm text-danger">{state.errors._form}</p>}
          {state?.ok && <p className="text-sm text-success">University created successfully.</p>}
          <SubmitButton loadingText="Creating…" className="w-full">Create University</SubmitButton>
        </form>
      )}
    </div>
  )
}
