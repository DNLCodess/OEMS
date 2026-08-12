import { Skeleton } from '@/components/ui/Skeleton'

export default function AdminStructureLoading() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </header>

      <main className="flex-1 p-6">
        <div className="max-w-4xl grid lg:grid-cols-3 gap-6">
          <div className="space-y-3">
            <Skeleton className="h-4 w-28 mb-2" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
          <div className="lg:col-span-2 space-y-3">
            <Skeleton className="h-4 w-40 mb-2" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
