'use client'

import { useActionState, useState } from 'react'
import { Building2, Pencil } from 'lucide-react'
import { updateUniversityBranding } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'

export function UniversityRow({ university, counts, countsUnavailable = false }) {
  const [editing, setEditing] = useState(false)
  const updateAction = updateUniversityBranding.bind(null, university.id)
  const [state, formAction] = useActionState(updateAction, null)

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary-light shrink-0 overflow-hidden">
            {university.logo_url
              ? <img src={university.logo_url} alt="" className="size-full object-cover" />
              : <Building2 size={18} className="text-primary" />
            }
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{university.name}</p>
            <p className="text-xs font-mono text-text-muted">{university.subdomain}.oems.edu</p>
          </div>
        </div>
        <div className="flex items-center gap-6 text-center shrink-0">
          {!countsUnavailable && (
            <>
              <div>
                <p className="text-lg font-bold text-text-primary tabular-nums">{counts.lecturers}</p>
                <p className="text-xs text-text-muted">Lecturers</p>
              </div>
              <div>
                <p className="text-lg font-bold text-text-primary tabular-nums">{counts.students}</p>
                <p className="text-xs text-text-muted">Students</p>
              </div>
              <div>
                <p className="text-lg font-bold text-text-primary tabular-nums">{counts.total}</p>
                <p className="text-xs text-text-muted">Total Users</p>
              </div>
            </>
          )}
          <button
            onClick={() => setEditing(v => !v)}
            className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-slate-50 transition-colors"
            title="Edit branding"
          >
            <Pencil size={14} />
          </button>
        </div>
      </div>

      {editing && (
        <form action={formAction} className="mt-4 pt-4 border-t border-border space-y-3">
          <div>
            <label htmlFor={`primary_color_${university.id}`} className="block text-sm font-medium text-text-primary mb-1.5">
              Brand color <span className="text-text-muted font-normal">(leave blank to use the default)</span>
            </label>
            <input
              id={`primary_color_${university.id}`} name="primary_color" type="text"
              defaultValue={university.primary_color ?? ''}
              placeholder="#3A0A5E"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            {state?.errors?.primary_color?.[0] && (
              <p className="text-xs text-danger mt-1">{state.errors.primary_color[0]}</p>
            )}
          </div>
          <Input
            id={`logo_url_${university.id}`} name="logo_url" label="Logo URL"
            defaultValue={university.logo_url ?? ''}
            placeholder="https://example.com/logo.png or /pcu/pcu-logo.jpeg"
            hint="A full URL, or a path already in this app's public folder."
            error={state?.errors?.logo_url?.[0]}
          />
          {state?.errors?._form && <p className="text-sm text-danger">{state.errors._form}</p>}
          {state?.ok && <p className="text-sm text-success">Branding updated.</p>}
          <SubmitButton loadingText="Saving…" className="w-full">Save Branding</SubmitButton>
        </form>
      )}
    </div>
  )
}
