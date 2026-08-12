import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { History } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { QueryErrorBanner } from '@/components/ui/QueryErrorBanner'

export const metadata = { title: 'Activity Log — OEMS' }

const ACTION_LABELS = {
  activated:    'Activated',
  deactivated:  'Deactivated',
  removed:      'Removed',
  logged_in:    'Logged in',
  logged_out:   'Logged out',
  login_failed: 'Login failed',
}

const ACTION_COLORS = {
  activated:    'bg-success-light text-success',
  deactivated:  'bg-slate-100 text-text-muted',
  removed:      'bg-danger-light text-danger',
  logged_in:    'bg-success-light text-success',
  logged_out:   'bg-slate-100 text-text-muted',
  login_failed: 'bg-danger-light text-danger',
}

const STAFF_ROLES = ['lecturer', 'school_admin', 'super_admin']

export default async function AdminLogsPage({ searchParams }) {
  await requireRole('school_admin')
  const supabase = await createClient()
  const { role: roleFilter } = await searchParams

  // No explicit .eq('university_id', ...) filter needed — RLS
  // (school_admin_read_own_action_log) already scopes this to the
  // caller's own university, same pattern used elsewhere in this app.
  let query = supabase
    .from('admin_action_log')
    .select(`
      id, action, created_at, subject_role, target_identifier,
      actor:actor_id ( full_name ),
      target:target_user_id ( full_name )
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  if (roleFilter === 'staff') query = query.in('subject_role', STAFF_ROLES)
  if (roleFilter === 'students') query = query.eq('subject_role', 'student')

  const { data: logs, error } = await query
  if (error) console.error('[AdminLogsPage]', error)

  return (
    <>
      <TopBar title="Activity Log" subtitle="Account actions and sign-ins at your university" />
      <main className="flex-1 p-6 space-y-4">
        <form className="flex items-center gap-2">
          <label htmlFor="role" className="text-xs font-medium text-text-muted">Show</label>
          <select
            id="role"
            name="role"
            defaultValue={roleFilter ?? ''}
            className="text-sm border border-border rounded-lg px-2.5 py-1.5 bg-surface"
          >
            <option value="">All</option>
            <option value="staff">Staff</option>
            <option value="students">Students</option>
          </select>
          <button type="submit" className="text-xs font-medium text-primary hover:underline">Apply</button>
        </form>

        {error ? (
          <QueryErrorBanner message="Failed to load activity log. Please refresh." />
        ) : !logs?.length ? (
          <EmptyState icon={History} title="No activity yet" description="Account actions and sign-ins will appear here." />
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-page">
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">When</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Actor</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Action</th>
                  <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map(log => (
                  <tr key={log.id}>
                    <td className="px-4 py-3 text-text-muted text-xs whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{log.actor?.full_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${ACTION_COLORS[log.action] ?? 'bg-slate-100 text-slate-600'}`}>
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-text-primary">
                      {log.target?.full_name ?? log.target_identifier ?? 'Unknown'}
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
