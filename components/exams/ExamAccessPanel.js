'use client'

import { useState, useTransition } from 'react'
import { Search, UserPlus, X, Users, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { searchEligibleStudents, addExamAccessStudent, removeExamAccessStudent } from '@/lib/actions/exams'

export function ExamAccessPanel({ examId, initialRestricted, examStatus }) {
  const [restricted, setRestricted] = useState(initialRestricted)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [pending, startTransition] = useTransition()

  const canEdit = examStatus === 'draft' || examStatus === 'scheduled'

  async function handleSearch(e) {
    e.preventDefault()
    if (query.trim().length < 2) return
    setSearching(true)
    const result = await searchEligibleStudents(examId, query)
    setSearching(false)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    setResults(result.students ?? [])
  }

  function handleAdd(student) {
    startTransition(async () => {
      const result = await addExamAccessStudent(examId, student.id)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      setRestricted(prev => [...prev, student])
      setResults(prev => prev.map(s => (s.id === student.id ? { ...s, added: true } : s)))
    })
  }

  function handleRemove(studentId) {
    startTransition(async () => {
      const result = await removeExamAccessStudent(examId, studentId)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      setRestricted(prev => prev.filter(s => s.id !== studentId))
      setResults(prev => prev.map(s => (s.id === studentId ? { ...s, added: false } : s)))
    })
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Users size={15} className="text-primary" />
        <h3 className="text-sm font-semibold text-text-primary">Exam Access</h3>
      </div>

      {restricted.length === 0 ? (
        <p className="text-xs text-text-muted mb-3">
          Open to all students.{canEdit ? ' Search below to restrict this exam to specific students.' : ''}
        </p>
      ) : (
        <>
          <p className="text-xs text-text-muted mb-2">
            Restricted to {restricted.length} student{restricted.length !== 1 ? 's' : ''}:
          </p>
          <ul className="space-y-1.5 mb-3">
            {restricted.map(s => (
              <li key={s.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-xs">
                <span>
                  <span className="font-medium text-text-primary">{s.full_name}</span>{' '}
                  <span className="font-mono text-text-muted">{s.matric_number}</span>
                </span>
                {canEdit && (
                  <button
                    onClick={() => handleRemove(s.id)}
                    disabled={pending}
                    className="text-text-muted hover:text-danger disabled:opacity-50"
                    title="Remove"
                  >
                    <X size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {canEdit ? (
        <>
          <form onSubmit={handleSearch} className="flex gap-2 mb-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by matric number or name"
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <button
              type="submit"
              disabled={searching || query.trim().length < 2}
              className="px-3 py-2 border border-border rounded-lg text-text-muted hover:text-primary disabled:opacity-50"
              title="Search"
            >
              <Search size={14} />
            </button>
          </form>

          {results.length > 0 && (
            <ul className="space-y-1.5">
              {results.map(s => (
                <li key={s.id} className="flex items-center justify-between px-3 py-2 text-xs">
                  <span>
                    <span className="font-medium text-text-primary">{s.full_name}</span>{' '}
                    <span className="font-mono text-text-muted">{s.matric_number}</span>
                  </span>
                  {s.added ? (
                    <span className="text-success">Added</span>
                  ) : (
                    <button
                      onClick={() => handleAdd(s)}
                      disabled={pending}
                      className="text-primary hover:text-primary-hover disabled:opacity-50"
                      title="Add"
                    >
                      <UserPlus size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-text-muted pt-2 border-t border-border">
          <Lock size={11} />
          Access list is locked once the exam starts.
        </p>
      )}
    </div>
  )
}
