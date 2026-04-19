import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign In' }

export default function LoginPage({ searchParams }) {
  return <LoginForm searchParams={searchParams} />
}
