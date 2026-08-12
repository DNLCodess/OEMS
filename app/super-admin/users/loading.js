import { Skeleton } from '@/components/ui/Skeleton'

export default function SuperAdminUsersLoading() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-48" />
        </div>
      </header>

      <main className="flex-1 p-6">
        <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </main>
    </div>
  )
}
