'use client'

import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { endStudentSession } from '@/lib/actions/studentAuth'

export function CheckAnotherResultButton() {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    await endStudentSession(null, '/check-result')
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-text-secondary hover:text-text-primary border border-border rounded-xl hover:bg-surface disabled:opacity-60 transition-colors"
    >
      <LogOut size={16} />
      {loading ? 'Signing out…' : 'Check another result'}
    </button>
  )
}
