import { CheckResultForm } from './CheckResultForm'

export const metadata = { title: 'Check Result — OEMS' }

export default function CheckResultPage() {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-primary text-white text-2xl font-bold mb-4">
            O
          </div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Check Your Result</h1>
          <p className="text-sm text-text-muted mt-1">
            Enter your matric number and date of birth
          </p>
        </div>

        <CheckResultForm />
      </div>
    </div>
  )
}
