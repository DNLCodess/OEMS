import { Skeleton } from '@/components/ui/Skeleton'

export default function LabResultLoading() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8 w-full">
      <Skeleton className="h-4 w-32 mb-6" />
      <div className="rounded-2xl border border-border p-8 mb-8 space-y-4">
        <Skeleton className="h-7 w-24 mx-auto" />
        <Skeleton className="h-14 w-40 mx-auto" />
        <Skeleton className="h-4 w-64 mx-auto" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}
