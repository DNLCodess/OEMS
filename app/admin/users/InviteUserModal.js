'use client'

import { useActionState, useState } from 'react'
import { X, UserPlus, Copy, Check } from 'lucide-react'
import { inviteUser } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'

export function InviteUserModal({ faculties, departments }) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState('lecturer')
  const [copied, setCopied] = useState(false)
  const [state, formAction] = useActionState(inviteUser, null)

  function close() {
    setOpen(false)
    setCopied(false)
  }

  async function handleCopy() {
    if (!state?.tempPassword) return
    await navigator.clipboard.writeText(state.tempPassword)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const deptOptions = departments.map(d => ({ value: d.id, label: `${d.name} (${d.faculties?.name ?? ''})` }))

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors"
      >
        <UserPlus size={15} />
        Invite User
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            {state?.ok ? (
              <>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-base font-semibold text-text-primary">User Invited</h2>
                  <button onClick={close} className="p-1.5 rounded text-text-muted hover:text-text-primary">
                    <X size={16} />
                  </button>
                </div>
                <p className="text-sm text-text-secondary mb-4">
                  <span className="font-medium text-text-primary">{state.email}</span> can now sign in with the
                  one-time temporary password below. This is shown only once — copy it and share it with them
                  directly. They should reset it via Forgot Password on first login.
                </p>
                <div className="flex items-center gap-2 mb-5">
                  <div className="flex-1 bg-page border border-border rounded-xl px-4 py-3 text-center">
                    <span className="text-base font-mono font-semibold tracking-wide text-text-primary break-all">
                      {state.tempPassword}
                    </span>
                  </div>
                  <button
                    onClick={handleCopy}
                    className="p-3 border border-border rounded-xl text-text-muted hover:text-primary hover:border-primary/30 transition-colors shrink-0"
                    title="Copy password"
                  >
                    {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                  </button>
                </div>
                <button
                  onClick={close}
                  className="w-full py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-hover transition-colors"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-base font-semibold text-text-primary">Invite User</h2>
                  <button onClick={close} className="p-1.5 rounded text-text-muted hover:text-text-primary">
                    <X size={16} />
                  </button>
                </div>

                <form action={formAction} className="space-y-4">
                  <Input
                    id="full_name" name="full_name" label="Full Name"
                    placeholder="Dr. Amara Okonkwo" required
                    error={state?.errors?.full_name?.[0]}
                  />
                  <Input
                    id="email" name="email" type="email" label="Email Address"
                    placeholder="user@university.edu.ng" required
                    error={state?.errors?.email?.[0]}
                  />

                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1.5">Role</label>
                    <select
                      name="role"
                      value={role}
                      onChange={e => setRole(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    >
                      <option value="lecturer">Lecturer</option>
                      <option value="school_admin">Exam Officer</option>
                    </select>
                  </div>

                  {deptOptions.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-1.5">Department <span className="text-text-muted font-normal">(optional)</span></label>
                      <select name="department_id" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary">
                        <option value="">— Select department —</option>
                        {deptOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  )}

                  <p className="text-xs text-text-muted bg-page rounded-lg px-3 py-2">
                    A one-time temporary password will be generated after you submit — you&apos;ll need to copy it
                    and share it with the invitee yourself.
                  </p>

                  {state?.errors?._form && (
                    <p className="text-sm text-danger">{state.errors._form}</p>
                  )}

                  <div className="flex gap-3 pt-1">
                    <SubmitButton className="flex-1" loadingText="Inviting…">Invite User</SubmitButton>
                    <button type="button" onClick={close} className="flex-1 py-2.5 border border-border text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors">
                      Cancel
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
