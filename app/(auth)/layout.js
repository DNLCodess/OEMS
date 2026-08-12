import { GraduationCap } from 'lucide-react'
import { BrandedPageBackground } from '@/components/shared/BrandedPageBackground'

export const metadata = {
  title: 'Sign In',
}

export default function AuthLayout({ children }) {
  return (
    <BrandedPageBackground>
      <div className="min-h-full flex flex-col items-center justify-center px-4 py-12">
        {/* Brand mark — gives the auth page a sense of place without a heavy header */}
        <div className="flex items-center gap-3 mb-8">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary">
            <GraduationCap className="size-6 text-white" />
          </span>
          <div>
            <p className="text-base font-bold text-text-primary leading-tight">OEMS</p>
            <p className="text-xs text-text-muted leading-tight">Online Examination Management System</p>
          </div>
        </div>

        {/* Card */}
        <div className="w-full max-w-sm bg-surface rounded-2xl border border-border shadow-sm p-8">
          {children}
        </div>
      </div>
    </BrandedPageBackground>
  )
}
