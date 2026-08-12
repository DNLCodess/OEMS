import { Skeleton } from '@/components/ui/Skeleton'

export default function ResultsLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6 max-w-md">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>

      <div className="grid gap-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-5 space-y-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
