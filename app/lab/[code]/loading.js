import { Skeleton } from '@/components/ui/Skeleton'

export default function LabLobbyLoading() {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-xl space-y-6">
        <Skeleton className="h-7 w-40 mx-auto" />
        <div className="text-center space-y-2">
          <Skeleton className="h-4 w-32 mx-auto" />
          <Skeleton className="h-8 w-64 mx-auto" />
          <Skeleton className="h-4 w-48 mx-auto" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-11 w-40 mx-auto rounded-xl" />
      </div>
    </div>
  )
}
