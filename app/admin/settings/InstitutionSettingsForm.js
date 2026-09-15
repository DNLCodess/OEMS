'use client'

import { useActionState } from 'react'
import { updateInstitutionSettings } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'

export function InstitutionSettingsForm({ institution }) {
  const [state, formAction] = useActionState(updateInstitutionSettings, null)

  return (
    <form action={formAction} className="space-y-4 max-w-md">
      <Input
        id="name" name="name" label="Institution Name"
        defaultValue={institution?.name ?? ''} required
        error={state?.errors?.name?.[0]}
      />
      <Input
        id="primary_color" name="primary_color" label="Primary Color (hex, optional)"
        placeholder="#1a56db" defaultValue={institution?.primary_color ?? ''}
        error={state?.errors?.primary_color?.[0]}
      />
      <Input
        id="logo_url" name="logo_url" label="Logo URL or path (optional)"
        placeholder="/pcu/logo.png" defaultValue={institution?.logo_url ?? ''}
        error={state?.errors?.logo_url?.[0]}
      />
      {state?.errors?._form && <p className="text-sm text-danger">{state.errors._form}</p>}
      {state?.ok && <p className="text-sm text-success">Saved.</p>}
      <SubmitButton loadingText="Saving…">Save Settings</SubmitButton>
    </form>
  )
}
