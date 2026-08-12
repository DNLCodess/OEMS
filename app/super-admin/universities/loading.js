import { Skeleton } from '@/components/ui/Skeleton'

export default function SuperAdminUniversitiesLoading() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl space-y-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      </main>
    </div>
  )
}
