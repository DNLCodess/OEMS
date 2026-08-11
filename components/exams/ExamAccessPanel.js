'use client'

import { useState, useTransition } from 'react'
import { Search, UserPlus, X, Users, Lock, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { searchEligibleStudents, addExamAccessStudent, removeExamAccessStudent, bulkAddExamAccessStudents } from '@/lib/actions/exams'
import { parseMatricListFromPaste, parseMatricListFromCsvText, parseMatricListFromXlsxBuffer } from '@/lib/parseMatricList'

const MODES = [
  { value: 'search', label: 'Search' },
  { value: 'paste',  label: 'Paste list' },
  { value: 'upload', label: 'Upload file' },
]

export function ExamAccessPanel({ examId, initialRestricted, examStatus }) {
  const [restricted, setRestricted] = useState(initialRestricted)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [pending, startTransition] = useTransition()

  const [mode, setMode] = useState('search')
  const [pasteText, setPasteText] = useState('')
  const [filePreview, setFilePreview] = useState(null) // { fileName, matricNumbers } | null
  const [fileError, setFileError] = useState('')
  const [bulkResult, setBulkResult] = useState(null) // { added, alreadyAddedCount, notFound } | null

  const canEdit = examStatus === 'draft' || examStatus === 'scheduled'

  function changeMode(next) {
    setMode(next)
    setPasteText('')
    setFilePreview(null)
    setFileError('')
    setBulkResult(null)
  }

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

  function runBulkAdd(matricNumbers) {
    setBulkResult(null)
    startTransition(async () => {
      const result = await bulkAddExamAccessStudents(examId, matricNumbers)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      setRestricted(prev => [...prev, ...result.added])
      setBulkResult(result)
    })
  }

  function handlePasteSubmit() {
    const matricNumbers = parseMatricListFromPaste(pasteText)
    if (matricNumbers.length === 0) {
      toast.error('Enter at least one matric number.')
      return
    }
    runBulkAdd(matricNumbers)
    setPasteText('')
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return

    setFileError('')
    setBulkResult(null)

    const isCsv  = /\.csv$/i.test(file.name)
    const isXlsx = /\.xlsx$/i.test(file.name)
    if (!isCsv && !isXlsx) {
      setFileError('Please choose a .csv or .xlsx file.')
      setFilePreview(null)
      return
    }

    try {
      let matricNumbers
      if (isCsv) {
        const text = await file.text()
        matricNumbers = parseMatricListFromCsvText(text)
      } else {
        const buffer = await file.arrayBuffer()
        matricNumbers = await parseMatricListFromXlsxBuffer(buffer)
      }

      if (matricNumbers.length === 0) {
        setFileError('No matric numbers found in that file.')
        setFilePreview(null)
        return
      }

      setFilePreview({ fileName: file.name, matricNumbers })
    } catch {
      setFileError('Could not read that file. Please check the format and try again.')
      setFilePreview(null)
    }
  }

  function handleFileSubmit() {
    if (!filePreview) return
    runBulkAdd(filePreview.matricNumbers)
    setFilePreview(null)
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Users size={15} className="text-primary" />
        <h3 className="text-sm font-semibold text-text-primary">Exam Access</h3>
      </div>

      {restricted.length === 0 ? (
        <p className="text-xs text-text-muted mb-3">
          Open to all students.{canEdit ? ' Add students below to restrict this exam to specific students.' : ''}
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
          <div className="flex gap-1 mb-3 border-b border-border">
            {MODES.map(m => (
              <button
                key={m.value}
                type="button"
                onClick={() => changeMode(m.value)}
                className={[
                  'px-2.5 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors',
                  mode === m.value
                    ? 'border-primary text-primary'
                    : 'border-transparent text-text-muted hover:text-text-primary',
                ].join(' ')}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === 'search' && (
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
          )}

          {mode === 'paste' && (
            <div className="space-y-2">
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                rows={4}
                placeholder={'CSC/2021/001\nCSC/2021/002, CSC/2021/003'}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              <button
                type="button"
                onClick={handlePasteSubmit}
                disabled={pending || pasteText.trim().length === 0}
                className="px-3 py-2 border border-border rounded-lg text-xs font-medium text-text-primary hover:bg-slate-50 disabled:opacity-50"
              >
                Add to exam
              </button>
            </div>
          )}

          {mode === 'upload' && (
            <div className="space-y-2">
              <label className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-5 text-center cursor-pointer hover:border-primary/40 hover:bg-slate-50 transition-colors">
                <Upload size={16} className="text-text-muted" />
                <span className="text-xs text-text-secondary">Choose a .csv or .xlsx file</span>
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>

              {fileError && (
                <p className="text-xs text-danger">{fileError}</p>
              )}

              {filePreview && (
                <div className="flex items-center justify-between gap-2 bg-page rounded-lg px-3 py-2">
                  <p className="text-xs text-text-secondary">
                    <span className="font-medium text-text-primary">{filePreview.fileName}</span>
                    {' — '}{filePreview.matricNumbers.length} matric number{filePreview.matricNumbers.length !== 1 ? 's' : ''} found
                  </p>
                  <button
                    type="button"
                    onClick={handleFileSubmit}
                    disabled={pending}
                    className="shrink-0 px-3 py-1.5 border border-border rounded-lg text-xs font-medium text-text-primary hover:bg-white disabled:opacity-50"
                  >
                    Add to exam
                  </button>
                </div>
              )}
            </div>
          )}

          {bulkResult && (
            <div className="mt-3 text-xs bg-page rounded-lg px-3 py-2 space-y-1">
              {bulkResult.added.length > 0 && (
                <p className="text-success font-medium">{bulkResult.added.length} added.</p>
              )}
              {bulkResult.alreadyAddedCount > 0 && (
                <p className="text-text-muted">{bulkResult.alreadyAddedCount} already on the list.</p>
              )}
              {bulkResult.notFound.length > 0 && (
                <p className="text-danger">
                  {bulkResult.notFound.length} not found: {bulkResult.notFound.join(', ')}
                </p>
              )}
            </div>
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
