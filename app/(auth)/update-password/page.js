import { requireRole } from '@/lib/dal'
import { UpdatePasswordForm } from './UpdatePasswordForm'

export const metadata = { title: 'Set New Password — OEMS' }

export default async function UpdatePasswordPage() {
  // Credential-less student sessions must never be able to set a real,
  // permanent password on their otherwise-passwordless account.
  await requireRole('lecturer', 'school_admin', 'super_admin')

  return <UpdatePasswordForm />
}
