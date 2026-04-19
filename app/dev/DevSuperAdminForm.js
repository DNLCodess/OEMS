'use client'

import { useActionState } from 'react'
import { createSuperAdmin } from '@/lib/actions/dev'

const initialState = { error: null, success: false, email: null }

export default function DevSuperAdminForm() {
  const [state, formAction, pending] = useActionState(createSuperAdmin, initialState)

  if (state.success) {
    return (
      <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-4 text-sm text-green-800">
        <p className="font-semibold mb-1">Super admin created</p>
        <p className="font-mono text-xs">{state.email}</p>
        <p className="mt-2 text-green-700">
          Check your email to confirm the account, then{' '}
          <a href="/login" className="underline font-medium">sign in</a>.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="full_name" className="text-sm font-medium text-slate-700">
          Full Name
        </label>
        <input
          id="full_name"
          name="full_name"
          type="text"
          placeholder="e.g. Platform Administrator"
          required
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-400"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="admin@platform.com"
          required
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-400"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          placeholder="Min. 8 characters"
          required
          minLength={8}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-400"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-[#1E3A5F] hover:bg-[#162D4A] text-white text-sm font-semibold py-2.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {pending ? 'Creating…' : 'Create Super Admin'}
      </button>
    </form>
  )
}
