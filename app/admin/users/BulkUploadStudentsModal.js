'use client'

import { useActionState, useState, useEffect } from 'react'
import { X, Users } from 'lucide-react'
import { bulkUploadStudents } from '@/lib/actions/admin'
import { Select } from '@/components/ui/Select'
import { SubmitButton } from '@/components/ui/Button'

export function BulkUploadStudentsModal({ faculties, departments }) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(bulkUploadStudents, null)

  useEffect(() => {
    if (state?.ok && state.failed.length === 0) {
      setOpen(false)
    }
  }, [state])

  const deptOptions = departments.map(d => ({ value: d.id, label: `${d.name} (${d.faculties?.name ?? ''})` }))

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 border border-border text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
      >
        <Users size={15} />
        Upload Student Roster
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-text-primary">Upload Student Roster</h2>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded text-text-muted hover:text-text-primary">
                <X size={16} />
              </button>
            </div>

            <form action={formAction} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">
                  Roster — one student per line
                </label>
                <textarea
                  name="roster"
                  rows={8}
                  required
                  placeholder="CSC/2021/001,Amina Bello,300,2003-04-12&#10;CSC/2021/002,Femi Ade,200"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <p className="text-xs text-text-muted mt-1.5">
                  Format: matric number, full name, level, date of birth (YYYY-MM-DD, optional).
                  No password is created — students sign in with their matric number and an
                  exam access code.
                </p>
                {state?.errors?._form && (
                  <p className="text-sm text-danger mt-1.5">{state.errors._form}</p>
                )}
              </div>

              {deptOptions.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1.5">Department <span className="text-text-muted font-normal">(optional, applies to all rows)</span></label>
                  <select name="department_id" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary">
                    <option value="">— Select department —</option>
                    {deptOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}

              {state?.ok && (
                <div className="text-xs bg-page rounded-lg px-3 py-2 space-y-1">
                  <p className="text-success font-medium">{state.createdCount} student(s) created.</p>
                  {state.failed.length > 0 && (
                    <ul className="text-danger">
                      {state.failed.map((f, i) => (
                        <li key={i}>{f.matric_number}: {f.reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <SubmitButton className="flex-1" loadingText="Uploading…">Upload Roster</SubmitButton>
                <button type="button" onClick={() => setOpen(false)} className="flex-1 py-2.5 border border-border text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors">
                  Close
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
