'use client'

import { Download, Printer, CheckCircle2, XCircle } from 'lucide-react'

export function ResultsTable({ rows, totalPossible }) {
  // ── CSV export ──────────────────────────────────────────────────────────────
  function exportCSV() {
    const headers = ['Rank', 'Full Name', 'Matric Number', 'Score', 'Total', 'Percentage', 'Pass/Fail']
    const csvRows = rows.map((r, i) => [
      i + 1,
      r.full_name,
      r.matric_number ?? '—',
      r.score ?? 0,
      totalPossible,
      r.percentage ?? 0,
      r.passed === true ? 'Pass' : r.passed === false ? 'Fail' : '—',
    ])
    const csv = [headers, ...csvRows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'results.csv' })
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Print ───────────────────────────────────────────────────────────────────
  function handlePrint() {
    window.print()
  }

  const passCount = rows.filter(r => r.passed === true).length
  const avgScore  = rows.length
    ? Math.round(rows.reduce((s, r) => s + (r.score ?? 0), 0) / rows.length)
    : 0

  return (
    <div>
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Submissions',  value: rows.length },
          { label: 'Pass rate',    value: rows.length ? `${Math.round((passCount / rows.length) * 100)}%` : '—' },
          { label: 'Average score', value: rows.length ? `${avgScore}/${totalPossible}` : '—' },
        ].map(s => (
          <div key={s.label} className="bg-surface border border-border rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-text-primary">{s.value}</p>
            <p className="text-xs text-text-muted mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-end gap-2 mb-4 print:hidden">
        <button
          onClick={exportCSV}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-slate-50 transition-colors"
        >
          <Download size={14} />
          Export CSV
        </button>
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-slate-50 transition-colors"
        >
          <Printer size={14} />
          Print
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-slate-50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">#</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">Student</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">Score</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">%</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wide">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-text-muted text-sm">
                  No submissions yet.
                </td>
              </tr>
            ) : rows.map((row, index) => (
              <tr key={row.attempt_id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 text-text-muted">{index + 1}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-text-primary">{row.full_name}</p>
                  {row.matric_number && (
                    <p className="font-mono text-xs text-text-muted">{row.matric_number}</p>
                  )}
                </td>
                <td className="px-4 py-3 font-medium tabular-nums">
                  {row.score ?? 0}/{totalPossible}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {row.percentage ?? 0}%
                </td>
                <td className="px-4 py-3">
                  {row.passed === true  && <span className="inline-flex items-center gap-1 text-success text-xs font-semibold"><CheckCircle2 size={13} />Pass</span>}
                  {row.passed === false && <span className="inline-flex items-center gap-1 text-danger  text-xs font-semibold"><XCircle     size={13} />Fail</span>}
                  {row.passed === null  && <span className="text-text-muted text-xs">Pending</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
