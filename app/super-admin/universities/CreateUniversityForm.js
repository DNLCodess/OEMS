'use client'

import { useActionState, useState } from 'react'
import { Plus, ChevronDown, ChevronUp } from 'lucide-react'
import { createUniversity } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'

export function CreateUniversityForm() {
  const [open, setOpen] = useState(false)
  const [useCustomColor, setUseCustomColor] = useState(false)
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
            hint="Lowercase letters, numbers, hyphens only — e.g. unilag, ui, abu. Becomes their /{subdomain}/login link."
            required
            error={state?.errors?.subdomain?.[0]}
          />
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useCustomColor}
                onChange={e => setUseCustomColor(e.target.checked)}
                className="rounded accent-primary"
              />
              <span className="text-sm font-medium text-text-primary">Use a custom brand color</span>
            </label>
            <p className="text-xs text-text-muted">
              Off by default — the university uses the platform&apos;s default look until you set one, here or later from the list below.
            </p>
            {useCustomColor && (
              <div className="flex items-end gap-3">
                <div>
                  <label htmlFor="primary_color" className="block text-sm font-medium text-text-primary mb-1.5">
                    Brand color
                  </label>
                  {/* A native color input always submits a 6-digit hex — it
                      can never be left "empty" — so the only way to let a
                      super admin genuinely choose "no override, use the
                      platform default" is to keep the field entirely out of
                      the form when they haven't opted in, rather than rely
                      on the input's own value. */}
                  <input
                    id="primary_color" name="primary_color" type="color" defaultValue="#3A0A5E"
                    className="h-10 w-16 rounded-lg border border-border cursor-pointer"
                  />
                </div>
                {state?.errors?.primary_color?.[0] && (
                  <p className="text-sm text-danger">{state.errors.primary_color[0]}</p>
                )}
              </div>
            )}
          </div>
          <Input
            id="logo_url" name="logo_url" label="Logo URL"
            placeholder="https://example.com/logo.png"
            hint="Optional — a full URL (https://…), or a path like /pcu/pcu-logo.jpeg for an image already in this app's public folder."
            error={state?.errors?.logo_url?.[0]}
          />
          {state?.errors?._form && <p className="text-sm text-danger">{state.errors._form}</p>}
          {state?.ok && <p className="text-sm text-success">University created successfully.</p>}
          <SubmitButton loadingText="Creating…" className="w-full">Create University</SubmitButton>
        </form>
      )}
    </div>
  )
}
