import { Skeleton } from '@/components/ui/Skeleton'

export default function AdminDashboardLoading() {
  return (
    <div className="h-full flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-40" />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface border border-border rounded-xl p-5 flex items-center gap-4">
              <Skeleton className="size-10 shrink-0" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-6 w-12" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-surface border border-border rounded-xl p-5">
              <Skeleton className="h-4 w-28 mb-4" />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            </div>
            <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
              <Skeleton className="h-4 w-32 mb-2" />
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </div>

          <div className="space-y-5">
            <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-full" />
              <div className="grid grid-cols-2 gap-3">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            </div>
            <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
