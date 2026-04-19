import { redirect } from 'next/navigation'
import DevSuperAdminForm from './DevSuperAdminForm'
import DevSeedButton from './DevSeedButton'

export default function DevPage() {
  if (process.env.NODE_ENV !== 'development') redirect('/')

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4 gap-6">
      <div className="w-full max-w-md rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 font-medium text-center">
        Dev-only page — not accessible in production
      </div>

      {/* Seed demo data */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 w-full max-w-md p-8">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight mb-1">Seed Demo Data</h1>
        <p className="text-sm text-slate-500 mb-6">
          Creates a university, faculties, departments, courses, 3 demo accounts, questions, a closed exam, a graded attempt, and a released result — ready to demo in one click.
        </p>
        <DevSeedButton />
      </div>

      {/* Bootstrap super admin */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 w-full max-w-md p-8">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight mb-1">Create Super Admin</h1>
        <p className="text-sm text-slate-500 mb-6">
          Bootstrap a platform-level admin account. Use this once per environment.
        </p>
        <DevSuperAdminForm />
      </div>
    </div>
  )
}
