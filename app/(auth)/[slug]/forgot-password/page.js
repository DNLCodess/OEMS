import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { ForgotPasswordForm } from '../../forgot-password/ForgotPasswordForm'
import { UniversityBadge } from '@/components/shared/UniversityBadge'
import { getUniversityThemeStyle } from '@/lib/universityTheme'

export const metadata = { title: 'Reset Password' }

export default async function UniversityForgotPasswordPage({ params }) {
  const { slug } = await params
  const adminClient = createAdminClient()
  const { data: university } = await adminClient
    .from('universities')
    .select('id, name, logo_url, primary_color')
    .eq('subdomain', slug.toLowerCase())
    .maybeSingle()

  if (!university) notFound()

  return (
    <div style={getUniversityThemeStyle(university)}>
      <UniversityBadge university={university} />
      <ForgotPasswordForm universitySlug={slug.toLowerCase()} />
    </div>
  )
}
