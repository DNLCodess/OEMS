'use client'

import { useActionState, useState, useEffect } from 'react'
import { X, UserPlus } from 'lucide-react'
import { inviteUser } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { SubmitButton } from '@/components/ui/Button'

export function InviteUserModal({ faculties, departments }) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState('lecturer')
  const [state, formAction] = useActionState(inviteUser, null)

  useEffect(() => {
    if (state?.ok) {
      setOpen(false)
    }
  }, [state?.ok])

  const deptOptions = departments.map(d => ({ value: d.id, label: `${d.name} (${d.faculties?.name ?? ''})` }))
  const facultyOptions = faculties.map(f => ({ value: f.id, label: f.name }))

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
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-text-primary">Invite User</h2>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded text-text-muted hover:text-text-primary">
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
                A temporary password <span className="font-mono font-medium">ChangeMe123!</span> will be set. Instruct the user to reset it via Forgot Password.
              </p>

              {state?.errors?._form && (
                <p className="text-sm text-danger">{state.errors._form}</p>
              )}

              <div className="flex gap-3 pt-1">
                <SubmitButton className="flex-1" loadingText="Inviting…">Invite User</SubmitButton>
                <button type="button" onClick={() => setOpen(false)} className="flex-1 py-2.5 border border-border text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
