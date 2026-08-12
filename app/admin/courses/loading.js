import { Skeleton } from '@/components/ui/Skeleton'

export default function AdminCoursesLoading() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl space-y-6">
        <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
          <Skeleton className="h-4 w-32" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>

        <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </main>
    </div>
  )
}
