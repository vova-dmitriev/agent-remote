import { cn } from "@/shared/lib/utils"
import { Skeleton } from "@/shared/ui/skeleton"
import { SESSION_CARD_IDS } from "../config/test-ids"
import { sessionCardBodyClass, sessionCardClass } from "./session-class"

export function SessionCardSkeleton() {
  return (
    <div className={sessionCardClass} data-testid={SESSION_CARD_IDS.skeleton} aria-hidden="true">
      <div className={sessionCardBodyClass}>
        <Skeleton className="col-span-2 h-4 w-44" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className={cn(sessionCardBodyClass, "size-2 rounded-full")} />
      <Skeleton className={cn(sessionCardBodyClass, "size-5")} />
    </div>
  )
}
