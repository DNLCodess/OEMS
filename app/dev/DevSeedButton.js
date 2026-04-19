'use client'

import { useState, useTransition } from 'react'
import { seedDemoData } from '@/lib/actions/dev'
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'

export default function DevSeedButton() {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState(null)

  function handleSeed() {
    startTransition(async () => {
      const res = await seedDemoData()
      setResult(res)
    })
  }

  if (result?.ok) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-green-700">
          <CheckCircle2 size={18} />
          <span className="font-medium text-sm">Demo data seeded successfully!</span>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-200 divide-y divide-slate-200">
          {result.summary.accounts.map(acc => (
            <div key={acc.email} className="px-4 py-3">
              <p className="text-xs font-semibold text-slate-500 uppercase">{acc.role}</p>
              <p className="font-mono text-sm text-slate-800">{acc.email}</p>
              <p className="font-mono text-xs text-slate-500">Password: {acc.password}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400">
          University: <span className="font-medium">{result.summary.university}</span>
        </p>
      </div>
    )
  }

  if (result?.error) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p className="text-sm">{result.error}</p>
        </div>
        <button onClick={() => setResult(null)} className="text-sm text-slate-500 hover:text-slate-800 underline">
          Try again
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={handleSeed}
      disabled={pending}
      className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-700 disabled:opacity-60 transition-colors"
    >
      {pending && <Loader2 size={15} className="animate-spin" />}
      {pending ? 'Seeding…' : 'Seed Demo Data'}
    </button>
  )
}
