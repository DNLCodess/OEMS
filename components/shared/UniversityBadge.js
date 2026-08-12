import { Building2 } from 'lucide-react'

// Shown above a form on a /{slug}/... page, identifying which institution
// this branded page belongs to — same visual pattern as /lab/[code]'s
// "Lab Session · Code: X" pill. Shown alongside, not instead of, the
// generic OEMS brand mark the shared (auth) layout always renders — this is
// tenant identity, not platform identity.
export function UniversityBadge({ university }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      <span className="flex items-center gap-1.5 bg-primary text-white text-xs font-semibold px-3 py-1.5 rounded-full">
        {university.logo_url
          ? <img src={university.logo_url} alt="" className="size-3.5 rounded-full object-cover" />
          : <Building2 size={12} />
        }
        {university.name}
      </span>
    </div>
  )
}
