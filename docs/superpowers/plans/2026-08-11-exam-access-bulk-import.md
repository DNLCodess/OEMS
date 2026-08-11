# Exam Access Bulk Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a lecturer add many students to an exam's access allow-list at once, via a pasted list or an uploaded CSV/XLSX file, alongside the existing one-at-a-time search-and-add.

**Architecture:** A new pure parsing utility (`lib/parseMatricList.js`) turns pasted text, CSV text, or an XLSX buffer into a plain array of matric-number strings. A new server action (`bulkAddExamAccessStudents` in `lib/actions/exams.js`) matches those against the university's active student roster and inserts new `exam_access` rows. `ExamAccessPanel.js` gains two new modes (paste / upload) alongside its existing search mode, both funneling into the same server action and the same result display.

**Tech Stack:** Next.js 16 Server Actions, Supabase/Postgres, Zod, Vitest. New dependency: `xlsx` (SheetJS), imported dynamically on the client only.

## Global Constraints

- New dependency `xlsx` is added to `package.json` and imported with a dynamic `await import('xlsx')` — never a static top-level import — so it's excluded from any page bundle that doesn't use it.
- No new Supabase migration: `exam_access` already exists and needs no schema change.
- Matching is by `matric_number` only, scoped to `university_id = <lecturer's university>`, `role = 'student'`, `is_active = true` — the exact same scoping `searchEligibleStudents` already uses.
- Unmatched matric numbers are reported back to the lecturer, never used to create new accounts — account creation stays the Exam Officer's bulk roster upload, a separate flow.
- Bulk import is blocked under the same rule as the existing single-add/remove actions: only when `exam.status` is `draft` or `scheduled`.
- Reject more than 1000 matric numbers in one call, both client-side (before ever calling the server) and server-side (defense in depth) — comfortably above any realistic single-exam cohort, and a guard against a pathological payload.
- This codebase has no React component test setup (no `@testing-library/react` in `package.json`) — only pure logic (actions, validations, utils) is unit tested. The UI task is verified by a clean `npx next build` and a manual QA checklist, not new automated tests, matching existing project convention.

---

### Task 1: Matric list parsing utility

**Files:**
- Create: `lib/parseMatricList.js`
- Test: `lib/parseMatricList.test.js`
- Modify: `package.json` (add `xlsx` dependency)

**Interfaces:**
- Produces (used by Task 3):
  - `parseMatricListFromPaste(text: string): string[]`
  - `parseMatricListFromCsvText(text: string): string[]`
  - `parseMatricListFromXlsxBuffer(arrayBuffer: ArrayBuffer): Promise<string[]>`
  - `extractMatricColumn(rows: Array<Array<any>>): string[]` (exported for direct testing; also used internally by the CSV/XLSX parsers)
  - `parseCsvText(text: string): Array<Array<string>>` (exported for direct testing; also used internally by `parseMatricListFromCsvText`)

- [ ] **Step 1: Add the `xlsx` dependency**

Run:
```bash
npm install xlsx
```

This adds an entry like `"xlsx": "^0.18.5"` (or newer) to `package.json`'s `dependencies`. Confirm it installed:
```bash
node -e "require('xlsx'); console.log('xlsx OK')"
```
Expected: prints `xlsx OK` with no error.

- [ ] **Step 2: Write the failing tests**

Create `lib/parseMatricList.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  extractMatricColumn,
  parseCsvText,
  parseMatricListFromCsvText,
  parseMatricListFromPaste,
  parseMatricListFromXlsxBuffer,
} from './parseMatricList'

describe('extractMatricColumn', () => {
  it('returns an empty array for empty input', () => {
    expect(extractMatricColumn([])).toEqual([])
  })

  it('uses the first column of every row when there is no recognizable header', () => {
    const rows = [['CSC/2021/001', 'Amina Bello'], ['CSC/2021/002', 'Femi Ade']]
    expect(extractMatricColumn(rows)).toEqual(['CSC/2021/001', 'CSC/2021/002'])
  })

  it('skips the header row when the first cell matches a known alias', () => {
    const rows = [['Matric Number', 'Name'], ['CSC/2021/001', 'Amina Bello']]
    expect(extractMatricColumn(rows)).toEqual(['CSC/2021/001'])
  })

  it('recognizes header aliases case-insensitively and with surrounding whitespace', () => {
    const rows = [[' Reg No '], ['CSC/2021/001']]
    expect(extractMatricColumn(rows)).toEqual(['CSC/2021/001'])
  })

  it('normalizes case, trims whitespace, and dedupes', () => {
    const rows = [['csc/2021/001'], [' CSC/2021/001 '], ['CSC/2021/002']]
    expect(extractMatricColumn(rows)).toEqual(['CSC/2021/001', 'CSC/2021/002'])
  })

  it('drops blank cells', () => {
    const rows = [['CSC/2021/001'], [''], ['   ']]
    expect(extractMatricColumn(rows)).toEqual(['CSC/2021/001'])
  })
})

describe('parseCsvText', () => {
  it('splits into rows and columns, trimming each cell', () => {
    expect(parseCsvText('CSC/2021/001, Amina Bello\nCSC/2021/002,Femi Ade')).toEqual([
      ['CSC/2021/001', 'Amina Bello'],
      ['CSC/2021/002', 'Femi Ade'],
    ])
  })

  it('drops blank lines', () => {
    expect(parseCsvText('CSC/2021/001\n\n\nCSC/2021/002')).toEqual([
      ['CSC/2021/001'],
      ['CSC/2021/002'],
    ])
  })
})

describe('parseMatricListFromCsvText', () => {
  it('extracts matric numbers from raw CSV text with a header row', () => {
    const csv = 'Matric Number,Name\nCSC/2021/001,Amina Bello\nCSC/2021/002,Femi Ade'
    expect(parseMatricListFromCsvText(csv)).toEqual(['CSC/2021/001', 'CSC/2021/002'])
  })

  it('extracts matric numbers from raw CSV text with no header row', () => {
    const csv = 'CSC/2021/001\nCSC/2021/002'
    expect(parseMatricListFromCsvText(csv)).toEqual(['CSC/2021/001', 'CSC/2021/002'])
  })
})

describe('parseMatricListFromPaste', () => {
  it('splits on newlines', () => {
    expect(parseMatricListFromPaste('CSC/2021/001\nCSC/2021/002')).toEqual(['CSC/2021/001', 'CSC/2021/002'])
  })

  it('splits on commas', () => {
    expect(parseMatricListFromPaste('CSC/2021/001, CSC/2021/002')).toEqual(['CSC/2021/001', 'CSC/2021/002'])
  })

  it('splits on a mix of newlines and commas, normalizes case, and dedupes', () => {
    const text = 'csc/2021/001, CSC/2021/002\nCSC/2021/001\n\nCSC/2021/003'
    expect(parseMatricListFromPaste(text)).toEqual(['CSC/2021/001', 'CSC/2021/002', 'CSC/2021/003'])
  })

  it('returns an empty array for blank input', () => {
    expect(parseMatricListFromPaste('   \n  ')).toEqual([])
  })
})

describe('parseMatricListFromXlsxBuffer', () => {
  it('extracts matric numbers from a real .xlsx workbook buffer, header row included', async () => {
    const XLSX = await import('xlsx')
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Matric Number', 'Name'],
      ['CSC/2021/001', 'Amina Bello'],
      ['CSC/2021/002', 'Femi Ade'],
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })

    const result = await parseMatricListFromXlsxBuffer(buffer)

    expect(result).toEqual(['CSC/2021/001', 'CSC/2021/002'])
  })

  it('extracts matric numbers from a workbook with no header row', async () => {
    const XLSX = await import('xlsx')
    const worksheet = XLSX.utils.aoa_to_sheet([['CSC/2021/001'], ['CSC/2021/002']])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })

    const result = await parseMatricListFromXlsxBuffer(buffer)

    expect(result).toEqual(['CSC/2021/001', 'CSC/2021/002'])
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run lib/parseMatricList.test.js`
Expected: FAIL — `lib/parseMatricList.js` does not exist yet (`Cannot find module './parseMatricList'`).

- [ ] **Step 4: Write the implementation**

Create `lib/parseMatricList.js`:

```js
const HEADER_ALIASES = new Set(['matric number', 'matric no', 'matric_number', 'reg no'])

function normalizeMatricNumbers(values) {
  return [...new Set(
    values
      .map(v => String(v ?? '').trim().toUpperCase())
      .filter(Boolean)
  )]
}

// Extracts matric numbers from a 2D array of rows (parsed CSV or XLSX sheet
// data). If the first row's first cell matches a known header alias, that
// row is skipped and its column used for every remaining row; otherwise
// every row's first column is used and nothing is skipped. Every other
// column in the sheet is ignored — a lecturer can drop in a whole roster
// export unmodified.
export function extractMatricColumn(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return []

  const firstCell = String(rows[0]?.[0] ?? '').trim().toLowerCase()
  const hasHeader = HEADER_ALIASES.has(firstCell)
  const dataRows  = hasHeader ? rows.slice(1) : rows

  return normalizeMatricNumbers(dataRows.map(row => row?.[0]))
}

// Splits raw CSV text into a 2D array of rows/columns. No quoted-comma
// support — the only expected content is a bare matric number per row, so a
// plain comma-split is sufficient.
export function parseCsvText(text) {
  return String(text ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split(',').map(cell => cell.trim()))
}

export function parseMatricListFromCsvText(text) {
  return extractMatricColumn(parseCsvText(text))
}

// A pasted list has no column concept — matric numbers may be separated by
// newlines, commas, or both.
export function parseMatricListFromPaste(text) {
  return normalizeMatricNumbers(String(text ?? '').split(/[\n,]/))
}

// Dynamically imports `xlsx` so it's only ever loaded by a browser session
// that actually uses the upload-file mode, not bundled into every page.
export async function parseMatricListFromXlsxBuffer(arrayBuffer) {
  const XLSX      = await import('xlsx')
  const workbook  = XLSX.read(arrayBuffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  const sheet     = workbook.Sheets[sheetName]
  const rows      = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  return extractMatricColumn(rows)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/parseMatricList.test.js`
Expected: PASS — all tests green.

- [ ] **Step 6: Run the full suite to confirm nothing else broke**

Run: `npx vitest run`
Expected: PASS — all tests green, including the new file.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/parseMatricList.js lib/parseMatricList.test.js
git commit -m "feat: add matric-list parsing for CSV/XLSX/paste input"
```

---

### Task 2: `bulkAddExamAccessStudents` server action

**Files:**
- Modify: `lib/actions/exams.js` (add new export, after `addExamAccessStudent`/`removeExamAccessStudent`, i.e. after line 349 in the current file)
- Modify: `lib/actions/exams.test.js` (add new `describe` block, after the existing `describe('addExamAccessStudent', ...)` block)

**Interfaces:**
- Consumes: `getOwnedExam(supabase, examId, userId, universityId)` (existing helper, already defined at the top of `lib/actions/exams.js`) — returns `{ id, status, created_by, university_id }` or `null`.
- Produces (used by Task 3):
  - `bulkAddExamAccessStudents(examId: string, matricNumbers: string[]): Promise<{ error: string } | { added: Array<{ id: string, full_name: string, matric_number: string }>, alreadyAddedCount: number, notFound: string[] }>`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `lib/actions/exams.test.js`, directly after the closing `})` of the existing `describe('addExamAccessStudent', ...)` block (after line 200) and before `describe('removeExamAccessStudent', ...)`:

```js
describe('bulkAddExamAccessStudents', () => {
  it('returns an error when the exam is not owned by this lecturer', async () => {
    const supabase = createMockSupabaseClient({ exams: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await bulkAddExamAccessStudents('exam-1', ['CSC/2021/001'])

    expect(result).toEqual({ error: 'Exam not found.' })
  })

  it('returns an error when the exam is live', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'live', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await bulkAddExamAccessStudents('exam-1', ['CSC/2021/001'])

    expect(result).toEqual({ error: 'Exam access cannot be changed once the exam has started.' })
    expect(supabase.from).not.toHaveBeenCalledWith('users')
  })

  it('returns an error when no matric numbers are given', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'draft', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await bulkAddExamAccessStudents('exam-1', ['', '   '])

    expect(result).toEqual({ error: 'No matric numbers to add.' })
    expect(supabase.from).not.toHaveBeenCalledWith('users')
  })

  it('returns an error when more than 1000 matric numbers are given', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'draft', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const tooMany = Array.from({ length: 1001 }, (_, i) => `CSC/2021/${i}`)
    const result = await bulkAddExamAccessStudents('exam-1', tooMany)

    expect(result).toEqual({ error: 'Too many at once — split into smaller batches.' })
    expect(supabase.from).not.toHaveBeenCalledWith('users')
  })

  it('normalizes case/whitespace and dedupes before matching', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'draft', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      users: [{ data: [{ id: 'stu-1', full_name: 'Amina Bello', matric_number: 'CSC/2021/001' }], error: null }],
      exam_access: [{ data: [], error: null }],
    })
    createClient.mockResolvedValue(supabase)

    await bulkAddExamAccessStudents('exam-1', ['csc/2021/001', ' CSC/2021/001 '])

    const usersBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'users').value
    expect(usersBuilder.in).toHaveBeenCalledWith('matric_number', ['CSC/2021/001'])
    expect(usersBuilder.eq).toHaveBeenCalledWith('university_id', 'uni-1')
    expect(usersBuilder.eq).toHaveBeenCalledWith('role', 'student')
    expect(usersBuilder.eq).toHaveBeenCalledWith('is_active', true)
  })

  it('returns notFound and skips the exam_access query entirely when nothing matches', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'draft', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      users: [{ data: [], error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await bulkAddExamAccessStudents('exam-1', ['CSC/2021/999'])

    expect(result).toEqual({ added: [], alreadyAddedCount: 0, notFound: ['CSC/2021/999'] })
    expect(supabase.from).not.toHaveBeenCalledWith('exam_access')
  })

  it('inserts only students not already on the allow-list, and reports alreadyAddedCount', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'draft', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      users: [{
        data: [
          { id: 'stu-1', full_name: 'Amina Bello', matric_number: 'CSC/2021/001' },
          { id: 'stu-2', full_name: 'Femi Ade',    matric_number: 'CSC/2021/002' },
        ],
        error: null,
      }],
      exam_access: [
        { data: [{ user_id: 'stu-1' }], error: null }, // existing allow-list — stu-1 already added
        { data: null, error: null },                    // the insert itself
      ],
    })
    createClient.mockResolvedValue(supabase)

    const result = await bulkAddExamAccessStudents('exam-1', ['CSC/2021/001', 'CSC/2021/002'])

    expect(result).toEqual({
      added: [{ id: 'stu-2', full_name: 'Femi Ade', matric_number: 'CSC/2021/002' }],
      alreadyAddedCount: 1,
      notFound: [],
    })
    const accessBuilders = supabase.from.mock.results
      .filter((_, i) => supabase.from.mock.calls[i][0] === 'exam_access')
      .map(r => r.value)
    const insertBuilder = accessBuilders.find(b => b.insert.mock.calls.length > 0)
    expect(insertBuilder.insert).toHaveBeenCalledWith([{ exam_id: 'exam-1', user_id: 'stu-2' }])
  })

  it('skips the insert call entirely when every matched student is already on the allow-list', async () => {
    const supabase = createMockSupabaseClient({
      exams: [{ data: { id: 'exam-1', status: 'draft', created_by: 'lect-1', university_id: 'uni-1' }, error: null }],
      users: [{ data: [{ id: 'stu-1', full_name: 'Amina Bello', matric_number: 'CSC/2021/001' }], error: null }],
      exam_access: [{ data: [{ user_id: 'stu-1' }], error: null }],
    })
    createClient.mockResolvedValue(supabase)

    const result = await bulkAddExamAccessStudents('exam-1', ['CSC/2021/001'])

    expect(result).toEqual({ added: [], alreadyAddedCount: 1, notFound: [] })
  })
})
```

Also update the import line near the top of `lib/actions/exams.test.js` (currently line 10) to include the new function:

```js
import { generateAccessCode, searchEligibleStudents, addExamAccessStudent, removeExamAccessStudent, bulkAddExamAccessStudents, updateExamStatus } from './exams'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/actions/exams.test.js`
Expected: FAIL — `bulkAddExamAccessStudents` is not exported from `./exams` yet.

- [ ] **Step 3: Write the implementation**

In `lib/actions/exams.js`, add this new function directly after `addExamAccessStudent` ends (after line 349, before the blank line preceding `export async function removeExamAccessStudent`):

```js
export async function bulkAddExamAccessStudents(examId, matricNumbers) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()

  const exam = await getOwnedExam(supabase, examId, user.id, user.university_id)
  if (!exam) return { error: 'Exam not found.' }
  if (exam.status === 'live' || exam.status === 'closed') {
    return { error: 'Exam access cannot be changed once the exam has started.' }
  }

  const normalized = [...new Set(
    (matricNumbers ?? [])
      .map(m => String(m ?? '').trim().toUpperCase())
      .filter(Boolean)
  )]
  if (normalized.length === 0) return { error: 'No matric numbers to add.' }
  if (normalized.length > 1000) return { error: 'Too many at once — split into smaller batches.' }

  const { data: matched } = await supabase
    .from('users')
    .select('id, full_name, matric_number')
    .eq('university_id', user.university_id)
    .eq('role', 'student')
    .eq('is_active', true)
    .in('matric_number', normalized)

  const matchedList      = matched ?? []
  const matchedMatricSet = new Set(matchedList.map(s => s.matric_number))
  const notFound          = normalized.filter(m => !matchedMatricSet.has(m))

  // Nothing matched — skip the allow-list check and insert entirely.
  if (matchedList.length === 0) {
    return { added: [], alreadyAddedCount: 0, notFound }
  }

  const { data: existing } = await supabase
    .from('exam_access')
    .select('user_id')
    .eq('exam_id', examId)
  const existingIds = new Set((existing ?? []).map(r => r.user_id))

  const newStudents       = matchedList.filter(s => !existingIds.has(s.id))
  const alreadyAddedCount = matchedList.length - newStudents.length

  if (newStudents.length > 0) {
    const { error } = await supabase
      .from('exam_access')
      .insert(newStudents.map(s => ({ exam_id: examId, user_id: s.id })))
    if (error) return { error: 'Failed to add students.' }
  }

  revalidatePath(`/lecturer/exams/${examId}`)
  return {
    added: newStudents.map(s => ({ id: s.id, full_name: s.full_name, matric_number: s.matric_number })),
    alreadyAddedCount,
    notFound,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/actions/exams.test.js`
Expected: PASS — all tests green, including the 8 new ones.

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

Run: `npx vitest run`
Expected: PASS — all tests green.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/exams.js lib/actions/exams.test.js
git commit -m "feat: add bulkAddExamAccessStudents server action"
```

---

### Task 3: Wire paste and upload modes into ExamAccessPanel

**Files:**
- Modify: `components/exams/ExamAccessPanel.js` (full rewrite — the file is 147 lines; every section changes or is adjacent to a change, so replacing the whole file is clearer than a fragment-by-fragment patch)

**Interfaces:**
- Consumes:
  - `parseMatricListFromPaste`, `parseMatricListFromCsvText`, `parseMatricListFromXlsxBuffer` from `@/lib/parseMatricList` (Task 1)
  - `bulkAddExamAccessStudents` from `@/lib/actions/exams` (Task 2), returning `{ error }` or `{ added: Array<{id, full_name, matric_number}>, alreadyAddedCount, notFound }`
- Produces: no new exports — `ExamAccessPanel`'s own props (`examId`, `initialRestricted`, `examStatus`) are unchanged, so its one call site in `app/lecturer/exams/[id]/page.js` needs no edit.

- [ ] **Step 1: Replace the file**

Replace the entire contents of `components/exams/ExamAccessPanel.js` with:

```jsx
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
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — this component has no automated tests (this codebase doesn't unit-test React components), so this step only confirms Tasks 1–2 are still green.

- [ ] **Step 3: Run the production build**

Run: `npx next build`
Expected: builds cleanly with no type/import errors. This is the primary automated verification for this task, since it's a client component with no unit test coverage in this project.

- [ ] **Step 4: Manual QA checklist**

Run `npm run dev`, sign in as a lecturer with a draft exam, open that exam's detail page, and confirm:

1. The "Exam Access" panel shows three tabs: Search, Paste list, Upload file. Search behaves exactly as before.
2. **Paste list**: paste a mix of real and fake matric numbers (comma- and newline-separated) belonging to active students in your seed data. Click "Add to exam." Confirm the result line shows the right added/not-found counts, and the newly added students appear in the "Restricted to N students" list above without a page refresh.
3. **Upload file**: create a small `.csv` with a header row (`Matric Number`) and a few real matric numbers, upload it, confirm the preview shows the right count, click "Add to exam," confirm the same result/list behavior as the paste case.
4. Repeat the upload with a `.xlsx` file (e.g. save the same data from a spreadsheet app as `.xlsx`) — confirm it parses correctly too.
5. Upload a file with the wrong extension (e.g. `.txt`) — confirm the inline error message appears and nothing is submitted.
6. Re-run a paste or upload that includes a matric number already on the list — confirm it's reported under "already on the list," not re-added or errored.
7. Move the exam to `live` (or open one that already is) — confirm the whole tab bar disappears and the existing "Access list is locked once the exam starts" message shows instead, same as before this change.

- [ ] **Step 5: Commit**

```bash
git add components/exams/ExamAccessPanel.js
git commit -m "feat: add paste-list and file-upload modes to exam access panel"
```
