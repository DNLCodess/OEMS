'use client'

import { useActionState, useState } from 'react'
import { Building2, Pencil, UserPlus, Copy, Check } from 'lucide-react'
import { updateUniversityBranding, inviteExamOfficer } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'

export function UniversityRow({ university, counts, countsUnavailable = false }) {
  const [editing, setEditing] = useState(false)
  const updateAction = updateUniversityBranding.bind(null, university.id)
  const [state, formAction] = useActionState(updateAction, null)

  const [inviting, setInviting] = useState(false)
  const [copied, setCopied] = useState(false)
  const inviteAction = inviteExamOfficer.bind(null, university.id)
  const [inviteState, inviteFormAction] = useActionState(inviteAction, null)

  async function handleCopy() {
    if (!inviteState?.tempPassword) return
    await navigator.clipboard.writeText(inviteState.tempPassword)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

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
            <p className="text-xs font-mono text-text-muted">{university.subdomain}.pcu-cbt.edu</p>
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
            onClick={() => setInviting(v => !v)}
            className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-slate-50 transition-colors"
            title="Invite Exam Officer"
          >
            <UserPlus size={14} />
          </button>
          <button
            onClick={() => setEditing(v => !v)}
            className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-slate-50 transition-colors"
            title="Edit branding"
          >
            <Pencil size={14} />
          </button>
        </div>
      </div>

      {inviting && (
        inviteState?.ok ? (
          <div className="mt-4 pt-4 border-t border-border space-y-3">
            <p className="text-sm text-text-secondary">
              <span className="font-medium text-text-primary">{inviteState.email}</span> can now sign in with the
              one-time temporary password below. This is shown only once — copy it and share it with them
              directly. They should reset it via Forgot Password on first login.
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-page border border-border rounded-lg px-3 py-2 text-center">
                <span className="text-sm font-mono font-semibold tracking-wide text-text-primary break-all">
                  {inviteState.tempPassword}
                </span>
              </div>
              <button
                onClick={handleCopy}
                className="p-2.5 border border-border rounded-lg text-text-muted hover:text-primary hover:border-primary/30 transition-colors shrink-0"
                title="Copy password"
              >
                {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
              </button>
            </div>
            <button
              onClick={() => setInviting(false)}
              className="w-full py-2 border border-border text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <form action={inviteFormAction} className="mt-4 pt-4 border-t border-border space-y-3">
            <p className="text-xs text-text-muted">
              Bootstraps this university&apos;s first Exam Officer account. A one-time temporary
              password will be generated after you submit — you&apos;ll need to copy it and share
              it with them yourself.
            </p>
            <Input
              id={`officer_full_name_${university.id}`} name="full_name" label="Full Name"
              placeholder="Dr. Amara Okonkwo"
              error={inviteState?.errors?.full_name?.[0]}
            />
            <Input
              id={`officer_email_${university.id}`} name="email" type="email" label="Email Address"
              placeholder="officer@university.edu.ng"
              error={inviteState?.errors?.email?.[0]}
            />
            {inviteState?.errors?._form && <p className="text-sm text-danger">{inviteState.errors._form}</p>}
            <SubmitButton loadingText="Inviting…" className="w-full">Invite Exam Officer</SubmitButton>
          </form>
        )
      )}

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
