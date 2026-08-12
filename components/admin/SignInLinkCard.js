'use client'

import { useState } from 'react'
import { Copy, Check, Link2 } from 'lucide-react'

export function SignInLinkCard({ url }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <h2 className="text-sm font-semibold text-text-primary mb-1 flex items-center gap-1.5">
        <Link2 size={14} className="text-primary" />
        Your Staff Sign-In Link
      </h2>
      <p className="text-xs text-text-muted mb-3">
        Share this with your lecturers — it shows your institution&apos;s own branding on the sign-in page.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate text-xs bg-page border border-border rounded-lg px-3 py-2 text-text-secondary">
          {url}
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-xs font-medium text-text-secondary hover:bg-slate-50 transition-colors"
        >
          {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
