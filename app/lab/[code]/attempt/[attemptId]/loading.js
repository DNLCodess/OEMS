import { Skeleton } from '@/components/ui/Skeleton'

export default function LabAttemptLoading() {
  return (
    <div className="flex-1 flex flex-col">
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="flex-1 p-6 max-w-3xl mx-auto w-full space-y-4">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-4/5" />
        <div className="space-y-2 mt-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}
