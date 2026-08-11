# Exam Access — Bulk Import Design

**Goal:** Let a lecturer add many students to an exam's access allow-list at once, via a pasted list or an uploaded CSV/Excel file, instead of only one at a time through search-and-add.

**Architecture:** Two new client-side entry modes inside the existing `ExamAccessPanel` (paste-list and upload-file) both reduce down to the same array of matric-number strings and hand off to one new shared server action, `bulkAddExamAccessStudents`. The existing single-student search-and-add flow is untouched.

**Tech Stack:** Existing stack (Next.js Server Actions, Supabase/Postgres, Zod). One new dependency: `xlsx` (SheetJS), for parsing `.xlsx` files client-side.

## Current State

- `ExamAccessPanel` (`components/exams/ExamAccessPanel.js`) lives on the exam detail page (`app/lecturer/exams/[id]/page.js`), reached immediately after an exam is created and throughout editing, until the exam goes live.
- It supports exactly one way to restrict an exam: search by name/matric number (`searchEligibleStudents`), then click to add one student at a time (`addExamAccessStudent`).
- `exam_access` is a simple join table (`exam_id`, `user_id`) — an empty allow-list means the exam is open to every student in the university; any rows present restrict it to just those students.
- Access-list edits are already blocked once `exam.status` is `live` or `closed` (`canEdit` in the panel, enforced again server-side in `addExamAccessStudent`/`removeExamAccessStudent`).
- The university's existing admin roster upload (`bulkUploadStudents` in `lib/actions/admin.js`) establishes the UX convention this feature reuses: paste rows into a textarea, submit, get back a count of successes plus a list of failures with reasons. It creates new student *accounts*; this feature only links *existing* accounts to one exam, so its result shape is simpler (no per-row validation errors beyond "not found").
- No CSV/Excel parsing library exists anywhere in the project today.

## UI Design

`ExamAccessPanel` gains a three-way segmented control above the existing content, visible only when `canEdit` is true:

**[ Search ]  [ Paste list ]  [ Upload file ]**

- **Search** — unchanged, exactly the existing flow.
- **Paste list** — a `<textarea>` for matric numbers, one per line or comma-separated (same casual parsing as the admin roster paste: split on newlines, then on commas, trim, drop blanks). A "Add to exam" button submits the extracted list to `bulkAddExamAccessStudents`.
- **Upload file** — a file input accepting `.csv` and `.xlsx`. On file selection:
  - `.csv` is read as text and split into rows/columns with a small hand-rolled parser (comma-split per line; no quoted-comma support needed, since the only expected content is a bare matric number per row).
  - `.xlsx` is parsed with `xlsx` (dynamically imported client-side only, so it never bloats a page that doesn't use this panel) into a 2D array of cell values.
  - Either way, the result is a 2D array of rows. Column selection: if the first row's first cell (case-insensitively, trimmed) matches `matric number`, `matric no`, `matric_number`, or `reg no`, that row is treated as a header and its column index is used for every subsequent row; otherwise every row's first column is used and no row is skipped. Every other column in the sheet is ignored.
  - The extracted list is shown in a short preview ("14 matric numbers found") with an "Add to exam" button before anything is submitted — no auto-submit on file select, so a lecturer can cancel if they picked the wrong file.

Both non-search modes call the same client function, `submitBulkAdd(matricNumbers)`, which calls `bulkAddExamAccessStudents(examId, matricNumbers)` and renders one shared result panel:

```
12 added.
2 already on the list.
1 not found: CSC/2021/499
```

— using `text-success`/`text-muted`/`text-danger` styling consistent with the rest of the panel. The newly added students immediately appear in the existing "Restricted to N students" list above, exactly as a single search-add already does.

No client-side cap on row count is enforced beyond a practical sanity check: if more than 1000 matric numbers are extracted from one file, the UI stops and shows an error asking the lecturer to split the file, rather than sending an oversized payload. 1000 is comfortably above any realistic single-exam cohort at PCU.

## Server Design

New action in `lib/actions/exams.js`, placed next to the existing exam-access actions:

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
    .select('id, matric_number')
    .eq('university_id', user.university_id)
    .eq('role', 'student')
    .eq('is_active', true)
    .in('matric_number', normalized)

  const matchedByMatric = new Map((matched ?? []).map(s => [s.matric_number, s.id]))
  const notFound = normalized.filter(m => !matchedByMatric.has(m))

  const { data: existing } = await supabase
    .from('exam_access')
    .select('user_id')
    .eq('exam_id', examId)
  const existingIds = new Set((existing ?? []).map(r => r.user_id))

  const toInsert = [...matchedByMatric.values()]
    .filter(id => !existingIds.has(id))
    .map(user_id => ({ exam_id: examId, user_id }))

  const alreadyAddedCount = matchedByMatric.size - toInsert.length

  if (toInsert.length > 0) {
    const { error } = await supabase.from('exam_access').insert(toInsert)
    if (error) return { error: 'Failed to add students.' }
  }

  revalidatePath(`/lecturer/exams/${examId}`)
  return { addedCount: toInsert.length, alreadyAddedCount, notFound }
}
```

This mirrors `addExamAccessStudent`'s ownership/status checks exactly and reuses `getOwnedExam`. Matching is by `matric_number` scoped to the lecturer's own university and active students only — the same constraints `searchEligibleStudents` already applies. Duplicate matric numbers within the same input, and students already on the allow-list, are both handled without erroring.

## Data Flow

1. Lecturer picks "Paste list" or "Upload file" in `ExamAccessPanel`.
2. Client extracts a plain array of matric-number strings — from the textarea, or parsed from the CSV/XLSX file. The raw file itself is never sent anywhere.
3. Client calls `bulkAddExamAccessStudents(examId, matricNumbers)`.
4. Server normalizes, matches against the university's student roster, inserts new `exam_access` rows, and returns counts plus the unmatched list.
5. Panel re-renders: the "Restricted to N students" list grows, and the result summary shows what happened.

## Error Handling

- Empty paste / empty file / file with no usable column → client-side message before ever calling the server ("No matric numbers found in that file").
- Wrong file type selected → rejected by the file input's `accept` attribute plus a client-side extension check, with a clear message.
- Exam no longer editable (went live while the panel was open) → the existing server-side check in `bulkAddExamAccessStudents` returns the same error message `addExamAccessStudent` already uses, shown via the same toast pattern already in the panel.
- Unmatched matric numbers are never treated as a hard failure — the call still succeeds for everything that did match, and the not-found list is just informational, matching the "reasons for what didn't work, but don't block what did" precedent from `bulkUploadStudents`.

## Testing

- `lib/actions/exams.test.js` gains a `describe('bulkAddExamAccessStudents')` block covering: ownership check, live/closed exam rejection, normalization (case, whitespace, dedup within input), correct matching scoped to the lecturer's university and active students only, skipping students already on the allow-list, and the `notFound` list for non-matching matric numbers.
- Client-side CSV/XLSX parsing helpers are extracted into a small pure function (e.g. `lib/utils/parseMatricList.js`) so header-detection and column-selection logic can be unit tested directly without mounting the panel component.

## Out of Scope

- Creating new student accounts for unmatched matric numbers (that's the Exam Officer's bulk roster upload, a deliberately separate flow/role).
- Removing students in bulk (the existing one-at-a-time remove button is unchanged and sufficient — bulk removal wasn't requested).
- Any change to how the allow-list is enforced at exam-entry time (`verifyExamAccess` in `lib/actions/studentAuth.js`) — this feature only changes how rows get into `exam_access`, not how they're read.
