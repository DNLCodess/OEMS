'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'
import { signIn } from '@/lib/actions/auth'
import { use } from 'react'

export function LoginForm({ searchParams }) {
  const params = use(searchParams)
  const [state, formAction] = useActionState(signIn, null)

  const passwordUpdated = params?.message === 'password_updated'
  const accountSuspended = params?.error === 'account_suspended'

  return (
    <>
      <h1 className="text-xl font-bold text-text-primary mb-1">Sign in to your account</h1>
      <p className="text-sm text-text-secondary mb-6">
        Use your institutional email and password.
      </p>

      {/* Contextual notices — shown only when relevant */}
      {passwordUpdated && (
        <div className="mb-4 rounded-lg bg-success-light border border-success/20 px-4 py-3 text-sm text-success">
          Password updated. You can sign in with your new password.
        </div>
      )}
      {accountSuspended && (
        <div className="mb-4 rounded-lg bg-danger-light border border-danger/20 px-4 py-3 text-sm text-danger">
          Your account has been suspended. Contact your Exam Officer.
        </div>
      )}

      <form action={formAction} noValidate className="space-y-4">
        <Input
          id="email"
          name="email"
          type="email"
          label="Email address"
          placeholder="you@university.edu.ng"
          required
          autoComplete="email"
          autoFocus
          error={state?.errors?.email?.[0]}
        />
        <Input
          id="password"
          name="password"
          type="password"
          label="Password"
          placeholder="••••••••"
          required
          autoComplete="current-password"
          error={state?.errors?.password?.[0]}
        />

        {/* Form-level error (wrong credentials etc.) */}
        {state?.errors?._form && (
          <p role="alert" className="text-sm text-danger">
            {state.errors._form}
          </p>
        )}

        <SubmitButton className="w-full mt-2" loadingText="Signing in…">
          Sign in
        </SubmitButton>
      </form>

      <div className="mt-5 text-center">
        <Link
          href="/forgot-password"
          className="text-sm text-primary hover:text-primary-hover underline underline-offset-2"
        >
          Forgot your password?
        </Link>
      </div>

      <p className="mt-6 text-xs text-text-muted text-center leading-relaxed">
        Don&apos;t have an account? Contact your institution&apos;s Exam Officer to be registered.
      </p>
    </>
  )
}
