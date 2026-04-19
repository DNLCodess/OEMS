'use client'

import { useActionState } from 'react'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'
import { updatePassword } from '@/lib/actions/auth'

export function UpdatePasswordForm() {
  const [state, formAction] = useActionState(updatePassword, null)

  return (
    <>
      <h1 className="text-xl font-bold text-text-primary mb-1">Set new password</h1>
      <p className="text-sm text-text-secondary mb-6">
        Choose a strong password — at least 8 characters.
      </p>

      <form action={formAction} noValidate className="space-y-4">
        <Input
          id="password"
          name="password"
          type="password"
          label="New password"
          placeholder="••••••••"
          required
          autoFocus
          error={state?.errors?.password?.[0]}
        />

        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          label="Confirm new password"
          placeholder="••••••••"
          required
          error={state?.errors?.confirmPassword?.[0]}
        />

        {state?.errors?._form && (
          <p role="alert" className="text-sm text-danger">
            {state.errors._form}
          </p>
        )}

        <SubmitButton className="w-full mt-2" loadingText="Updating…">
          Update password
        </SubmitButton>
      </form>
    </>
  )
}
