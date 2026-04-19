// Lab code entry — students type the 6-character code shown on the projector.
// No layout chrome, works on any device in the lab.
import { LabCodeEntry } from './LabCodeEntry'

export const metadata = { title: 'Enter Lab Code — OEMS' }

export default function LabEntryPage() {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        {/* Branding */}
        <div className="text-center mb-10">
          <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-primary text-white text-2xl font-bold mb-4">
            O
          </div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">OEMS Exam</h1>
          <p className="text-sm text-text-muted mt-1">
            Enter the lab code displayed by your lecturer
          </p>
        </div>

        <LabCodeEntry />
      </div>
    </div>
  )
}
