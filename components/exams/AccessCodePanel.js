'use client'

import { useState } from 'react'
import { Copy, Check, RefreshCw, Loader2, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { generateAccessCode } from '@/lib/actions/exams'

export function AccessCodePanel({ examId, accessCode: initialCode, examStatus }) {
  const [code,        setCode]        = useState(initialCode)
  const [copied,      setCopied]      = useState(false)
  const [generating,  setGenerating]  = useState(false)

  const canGenerate = examStatus === 'live' || examStatus === 'scheduled' || examStatus === 'draft'

  async function handleCopy() {
    if (!code) return
    await navigator.clipboard.writeText(code)
    setCopied(true)
    toast.success('Access code copied')
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleGenerate() {
    setGenerating(true)
    const result = await generateAccessCode(examId)
    setGenerating(false)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    setCode(result.access_code)
    toast.success('New access code generated')
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <KeyRound size={15} className="text-primary" />
        <h3 className="text-sm font-semibold text-text-primary">Exam Access Code</h3>
      </div>

      {code ? (
        <>
          <p className="text-xs text-text-muted mb-2">
            Share this code with students. They enter it, with their matric number, at{' '}
            <span className="font-mono text-text-secondary">/lab</span>.
          </p>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 bg-slate-50 border border-border rounded-xl px-4 py-3 text-center">
              <span className="text-2xl font-mono font-bold tracking-[0.3em] text-text-primary">
                {code}
              </span>
            </div>
            <button
              onClick={handleCopy}
              className="p-3 border border-border rounded-xl text-text-muted hover:text-primary hover:border-primary/30 transition-colors"
              title="Copy code"
            >
              {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
            </button>
          </div>
          {canGenerate && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full flex items-center justify-center gap-2 py-2 text-xs text-text-muted border border-border rounded-lg hover:text-text-primary hover:border-border transition-colors disabled:opacity-50"
            >
              {generating
                ? <><Loader2 size={12} className="animate-spin" /> Generating…</>
                : <><RefreshCw size={12} /> Regenerate code</>
              }
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-text-muted mb-3">
            Generate a code so students can access this exam.
          </p>
          {canGenerate && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              {generating
                ? <><Loader2 size={14} className="animate-spin" /> Generating…</>
                : 'Generate Access Code'
              }
            </button>
          )}
        </>
      )}
    </div>
  )
}
