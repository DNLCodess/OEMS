import { requireRole } from '@/lib/dal'
import { listAllEntries } from '@/lib/db/repositories/labIpAllowlist'
import { TopBar } from '@/components/shared/TopBar'
import { AddEntryForm } from './AddEntryForm'
import { AddRangeForm } from './AddRangeForm'
import { ToggleEntryButton } from './ToggleEntryButton'
import { Wifi } from 'lucide-react'

export const metadata = { title: 'Lab Network — PCU CBT' }

export default async function AdminLabNetworkPage() {
  const user = await requireRole('school_admin', 'super_admin')
  const entries = await listAllEntries(user.university_id)
  const activeCount = entries.filter(e => e.is_active).length

  return (
    <>
      <TopBar
        title="Lab Network"
        subtitle="IP addresses and ranges allowed to enter and answer exams"
      />
      <main className="flex-1 p-6 max-w-4xl space-y-6">
        {activeCount === 0 && (
          <div className="bg-danger-light border border-danger/20 rounded-xl p-4">
            <p className="text-sm text-danger font-medium">
              No active entries. Exam entry will fail closed for every student until at least
              one entry is active.
            </p>
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-3">
          <AddEntryForm />
          <AddRangeForm />
        </div>

        {!entries.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
            <Wifi size={32} className="text-text-muted mb-3" />
            <p className="text-sm font-medium text-text-primary mb-1">No entries yet</p>
            <p className="text-xs text-text-muted">Add the lab's PC addresses above.</p>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-page">
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Entry</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Label</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map(e => (
                  <tr key={e.id} className={e.is_active ? '' : 'opacity-60'}>
                    <td className="px-4 py-3 font-mono text-text-primary">{e.entry}</td>
                    <td className="px-4 py-3 text-text-secondary">{e.label ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                        e.is_active ? 'bg-success-light text-success' : 'bg-slate-100 text-text-muted'
                      }`}>
                        {e.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ToggleEntryButton entryId={e.id} isActive={e.is_active} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  )
}
