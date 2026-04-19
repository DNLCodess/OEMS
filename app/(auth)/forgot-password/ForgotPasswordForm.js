'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'
import { forgotPassword } from '@/lib/actions/auth'
import { MailCheck } from 'lucide-react'

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(forgotPassword, null)

  if (state?.success) {
    return (
      <div className="text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-success-light mb-4">
          <MailCheck className="size-6 text-success" />
        </span>
        <h1 className="text-xl font-bold text-text-primary mb-2">Check your email</h1>
        <p className="text-sm text-text-secondary leading-relaxed">
          If that email is registered, you&apos;ll receive a reset link shortly. Check your inbox and spam folder.
        </p>
        <Link
          href="/login"
          className="inline-block mt-6 text-sm text-primary hover:text-primary-hover underline underline-offset-2"
        >
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <>
      <h1 className="text-xl font-bold text-text-primary mb-1">Reset your password</h1>
      <p className="text-sm text-text-secondary mb-6">
        Enter your email and we&apos;ll send you a reset link.
      </p>

      <form action={formAction} noValidate className="space-y-4">
        <Input
          id="email"
          name="email"
          type="email"
          label="Email address"
          placeholder="you@university.edu.ng"
          required
          autoFocus
          error={state?.errors?.email?.[0]}
        />

        {state?.errors?._form && (
          <p role="alert" className="text-sm text-danger">
            {state.errors._form}
          </p>
        )}

        <SubmitButton className="w-full mt-2" loadingText="Sending link…">
          Send reset link
        </SubmitButton>
      </form>

      <div className="mt-5 text-center">
        <Link
          href="/login"
          className="text-sm text-text-secondary hover:text-text-primary underline underline-offset-2"
        >
          Back to sign in
        </Link>
      </div>
    </>
  )
}
