import { requireRole } from '@/lib/dal'
import { listRecentActions } from '@/lib/db/repositories/auditLog'
import { TopBar } from '@/components/shared/TopBar'
import { format } from 'date-fns'

export const metadata = { title: 'Activity Log — PCU CBT' }

const ACTION_LABELS = {
  activated: 'Activated', deactivated: 'Deactivated', removed: 'Removed',
  logged_in: 'Signed in', logged_out: 'Signed out', login_failed: 'Sign-in failed',
  exam_entry_ip_blocked: 'Exam entry blocked (IP)',
}

export default async function AdminLogsPage() {
  await requireRole('school_admin', 'super_admin')
  const logs = await listRecentActions(200)

  return (
    <>
      <TopBar title="Activity Log" subtitle="Account actions and sign-ins at your institution" />
      <main className="flex-1 p-6">
        {!logs.length ? (
          <p className="text-sm text-text-muted py-8 text-center">No activity yet.</p>
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-page">
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Action</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Actor</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Target</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map(log => (
                  <tr key={log.id}>
                    <td className="px-4 py-3 text-text-primary font-medium">{ACTION_LABELS[log.action] ?? log.action}</td>
                    <td className="px-4 py-3 text-text-secondary">{log.actor?.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-text-secondary">{log.target?.full_name ?? log.target_identifier ?? '—'}</td>
                    <td className="px-4 py-3 text-text-muted text-xs">{format(new Date(log.created_at), 'PPp')}</td>
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
