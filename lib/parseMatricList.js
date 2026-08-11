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
