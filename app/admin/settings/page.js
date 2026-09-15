import { requireRole } from '@/lib/dal'
import { getInstitution } from '@/lib/db/repositories/institution'
import { TopBar } from '@/components/shared/TopBar'
import { InstitutionSettingsForm } from './InstitutionSettingsForm'

export const metadata = { title: 'Settings — PCU CBT' }

export default async function AdminSettingsPage() {
  await requireRole('super_admin')
  const institution = await getInstitution()

  return (
    <>
      <TopBar title="Institution Settings" subtitle="Name, logo, and branding color" />
      <main className="flex-1 p-6">
        <InstitutionSettingsForm institution={institution} />
      </main>
    </>
  )
}
