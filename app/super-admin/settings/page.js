import { requireRole } from '@/lib/dal'
import { TopBar } from '@/components/shared/TopBar'
import { Settings, Globe, Shield, Mail } from 'lucide-react'

export const metadata = { title: 'Platform Settings — OEMS' }

function SettingRow({ icon: Icon, label, value, mono = false }) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-border last:border-0">
      <div className="flex items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary-light">
          <Icon size={14} className="text-primary" />
        </span>
        <span className="text-sm font-medium text-text-primary">{label}</span>
      </div>
      <span className={`text-sm text-text-secondary ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

export default async function SuperAdminSettingsPage() {
  await requireRole('super_admin')

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'Not configured'
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'Not configured'

  return (
    <>
      <TopBar
        title="Platform Settings"
        subtitle="Read-only — configure via environment variables"
      />
      <main className="flex-1 p-6 max-w-2xl">
        <div className="space-y-4">
          <div className="bg-surface border border-border rounded-xl px-5">
            <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider pt-4 pb-2">Environment</h2>
            <SettingRow icon={Globe} label="Site URL" value={siteUrl} mono />
            <SettingRow icon={Settings} label="Supabase Project" value={supabaseUrl?.replace('https://', '').split('.')[0] ?? '—'} mono />
            <SettingRow icon={Shield} label="Environment" value={process.env.NODE_ENV ?? 'production'} />
          </div>

          <div className="bg-surface border border-border rounded-xl px-5">
            <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider pt-4 pb-2">Auth</h2>
            <SettingRow icon={Mail} label="Password Reset" value="Via Forgot Password → email link" />
            <SettingRow icon={Shield} label="Session Strategy" value="JWT (Supabase Auth)" />
          </div>

          <div className="bg-warning-light border border-warning/20 rounded-xl p-4">
            <p className="text-sm text-warning font-medium mb-1">To change these settings</p>
            <p className="text-sm text-warning/80">
              Update environment variables in your Vercel project settings or <code className="font-mono text-xs">.env.local</code> file, then redeploy.
            </p>
          </div>
        </div>
      </main>
    </>
  )
}
