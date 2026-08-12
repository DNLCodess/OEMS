import { Skeleton } from '@/components/ui/Skeleton'

export default function SuperAdminDashboardLoading() {
  return (
    <div className="h-full flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-48" />
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
          <div className="lg:col-span-2 space-y-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-5 space-y-3">
                <Skeleton className="h-4 w-32 mb-1" />
                <div className="grid grid-cols-4 gap-3">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <Skeleton key={j} className="h-14" />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-5 space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
