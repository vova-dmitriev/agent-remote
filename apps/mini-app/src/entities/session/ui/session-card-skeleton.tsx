import { Skeleton } from "@/shared/ui/skeleton"
import { SESSION_CARD_IDS } from "../config/test-ids"

export function SessionCardSkeleton() {
  return (
    <div className="session-card" data-testid={SESSION_CARD_IDS.skeleton} aria-hidden="true">
      <div>
        <Skeleton className="col-span-2 h-4 w-44" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="size-2 rounded-full" />
      <Skeleton className="size-5" />
    </div>
  )
}
