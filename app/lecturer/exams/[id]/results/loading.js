import { Skeleton } from '@/components/ui/Skeleton'

export default function ExamResultsLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <Skeleton className="h-4 w-20 mb-2" />

      <div className="mt-2 mb-6 space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-surface border border-border rounded-xl p-4 space-y-2">
            <Skeleton className="h-5 w-12 mx-auto" />
            <Skeleton className="h-3 w-16 mx-auto" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-surface border border-border rounded-xl p-5">
            <Skeleton className="h-4 w-40 mb-4" />
            <Skeleton className="h-28 w-full" />
          </div>
          <div className="bg-surface border border-border rounded-xl p-5 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
        <div className="space-y-5">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="bg-surface border border-border rounded-xl p-5 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
