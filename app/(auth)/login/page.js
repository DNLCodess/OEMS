import { redirect } from 'next/navigation'
import { readSessionUser } from '@/lib/auth/session'
import { roleHome } from '@/lib/dal'
import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign In' }

export default async function LoginPage({ searchParams }) {
  const user = await readSessionUser()
  if (user && user.is_active && !user.removed_at) redirect(roleHome(user.role))
  return <LoginForm searchParams={searchParams} />
}
