import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { LoginForm } from '../../login/LoginForm'
import { UniversityBadge } from '@/components/shared/UniversityBadge'
import { getUniversityThemeStyle } from '@/lib/universityTheme'

export const metadata = { title: 'Sign In' }

export default async function UniversityLoginPage({ params, searchParams }) {
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
      <LoginForm searchParams={searchParams} universitySlug={slug.toLowerCase()} />
    </div>
  )
}
