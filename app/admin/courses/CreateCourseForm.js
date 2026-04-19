'use client'

import { useActionState, useState } from 'react'
import { Plus, ChevronDown, ChevronUp } from 'lucide-react'
import { createCourse } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'

export function CreateCourseForm({ departments }) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(createCourse, null)

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-surface">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2"><Plus size={14} /> Add Course</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <form action={formAction} className="px-4 pb-4 space-y-3 border-t border-border bg-page">
          <div className="grid grid-cols-2 gap-3">
            <Input
              id="course_code" name="course_code" label="Course Code"
              placeholder="CSC 301" required
              error={state?.errors?.course_code?.[0]}
            />
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Credit Units</label>
              <select name="credit_units" defaultValue="3" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary">
                {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          <Input
            id="course_title" name="course_title" label="Course Title"
            placeholder="Data Structures and Algorithms" required
            error={state?.errors?.course_title?.[0]}
          />

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Department</label>
            <select name="department_id" required className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary">
              <option value="">— Select department —</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {state?.errors?.department_id && <p className="text-xs text-danger mt-1">{state.errors.department_id[0]}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Level</label>
              <select name="level" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary">
                {[['100','100 Level'],['200','200 Level'],['300','300 Level'],['400','400 Level'],['500','500 Level'],['PG','Postgraduate']].map(([v,l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Semester</label>
              <select name="semester" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary">
                <option value="first">First</option>
                <option value="second">Second</option>
              </select>
            </div>
          </div>

          {state?.errors?._form && <p className="text-sm text-danger">{state.errors._form}</p>}
          <SubmitButton loadingText="Creating…" className="w-full">Create Course</SubmitButton>
        </form>
      )}
    </div>
  )
}
