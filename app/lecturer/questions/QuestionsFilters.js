'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { Search, X } from 'lucide-react'

const TYPES = [
  { value: 'mcq',          label: 'MCQ' },
  { value: 'multi_select', label: 'Multi-select' },
  { value: 'true_false',   label: 'True/False' },
  { value: 'fill_blank',   label: 'Fill-in-blank' },
]

const DIFFICULTIES = [
  { value: 'easy',   label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard',   label: 'Hard' },
]

export function QuestionsFilters({ courses }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [, startTransition] = useTransition()

  const update = useCallback((key, value) => {
    const next = new URLSearchParams(params.toString())
    if (value) {
      next.set(key, value)
    } else {
      next.delete(key)
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`))
  }, [params, pathname, router])

  const clearAll = () => {
    startTransition(() => router.replace(pathname))
  }

  const hasFilters = params.get('course') || params.get('type') || params.get('difficulty') || params.get('q')

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search */}
      <div className="relative flex-1 min-w-48 max-w-64">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-text-muted pointer-events-none" />
        <input
          type="search"
          placeholder="Search questions…"
          defaultValue={params.get('q') ?? ''}
          onChange={e => {
            const v = e.target.value
            clearTimeout(window._qFilterTimer)
            window._qFilterTimer = setTimeout(() => update('q', v), 350)
          }}
          className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-border bg-surface placeholder:text-text-muted focus:outline-none focus:border-border-focus focus:ring-2 focus:ring-primary/15"
        />
      </div>

      {/* Course filter */}
      <select
        value={params.get('course') ?? ''}
        onChange={e => update('course', e.target.value)}
        className="py-2 pl-3 pr-8 text-sm rounded-lg border border-border bg-surface text-text-primary appearance-none focus:outline-none focus:border-border-focus cursor-pointer"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.5rem center',
        }}
      >
        <option value="">All courses</option>
        {courses.map(c => (
          <option key={c.id} value={c.id}>{c.course_code}</option>
        ))}
      </select>

      {/* Type filter */}
      <select
        value={params.get('type') ?? ''}
        onChange={e => update('type', e.target.value)}
        className="py-2 pl-3 pr-8 text-sm rounded-lg border border-border bg-surface text-text-primary appearance-none focus:outline-none focus:border-border-focus cursor-pointer"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.5rem center',
        }}
      >
        <option value="">All types</option>
        {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>

      {/* Difficulty filter */}
      <select
        value={params.get('difficulty') ?? ''}
        onChange={e => update('difficulty', e.target.value)}
        className="py-2 pl-3 pr-8 text-sm rounded-lg border border-border bg-surface text-text-primary appearance-none focus:outline-none focus:border-border-focus cursor-pointer"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.5rem center',
        }}
      >
        <option value="">All difficulties</option>
        {DIFFICULTIES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
      </select>

      {/* Clear all — only visible when filters are active */}
      {hasFilters && (
        <button
          onClick={clearAll}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-text-secondary hover:text-danger transition-colors"
        >
          <X className="size-3.5" />
          Clear
        </button>
      )}
    </div>
  )
}
