'use client'

import { useActionState, useState } from 'react'
import { Plus, ChevronDown, ChevronUp } from 'lucide-react'
import { createFaculty, createDepartment } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'

export function CreateFacultyForm() {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(createFaculty, null)

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2"><Plus size={14} /> Add Faculty</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <form action={async (fd) => { await formAction(fd); if (!state?.errors) setOpen(false) }} className="px-4 pb-4 space-y-3 border-t border-border bg-page">
          <Input
            id="faculty_name" name="name" label="Faculty Name"
            placeholder="Faculty of Science" required
            error={state?.errors?.name?.[0]}
          />
          {state?.errors?._form && <p className="text-sm text-danger">{state.errors._form}</p>}
          <SubmitButton loadingText="Creating…" className="w-full">Create Faculty</SubmitButton>
        </form>
      )}
    </div>
  )
}

export function CreateDepartmentForm({ faculties }) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(createDepartment, null)

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2"><Plus size={14} /> Add Department</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <form action={formAction} className="px-4 pb-4 space-y-3 border-t border-border bg-page">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Faculty</label>
            <select name="faculty_id" required className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary">
              <option value="">— Select faculty —</option>
              {faculties.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            {state?.errors?.faculty_id && <p className="text-xs text-danger mt-1">{state.errors.faculty_id[0]}</p>}
          </div>
          <Input
            id="dept_name" name="name" label="Department Name"
            placeholder="Computer Science" required
            error={state?.errors?.name?.[0]}
          />
          {state?.errors?._form && <p className="text-sm text-danger">{state.errors._form}</p>}
          <SubmitButton loadingText="Creating…" className="w-full">Create Department</SubmitButton>
        </form>
      )}
    </div>
  )
}
