import { ArrowLeft } from "lucide-react"
import { Skeleton } from "@/shared/ui/skeleton"
import { SESSION_PAGE_IDS } from "@/pages/session/config/test-ids"
import { HistorySkeleton } from "./session-feed/loading/history-skeleton"

const bar = "motion-reduce:animate-none"

/**
 * The session page before its session is known (a linked session waiting for the app to start or the snapshot to
 * arrive): the same header, feed and composer layout with the feed's own skeleton in the feed's place, so the real
 * page replaces it without a jump.
 */
export function SessionLoading() {
  return (
    <section
      className="session:flex session:min-h-0 session:flex-1 session:flex-col"
      data-testid={SESSION_PAGE_IDS.loading}
      aria-busy="true"
    >
      <div className="flex items-center gap-[8px] pt-[8px] short:pt-[4px]" aria-hidden="true">
        <span className="flex size-[32px] flex-none items-center justify-center text-muted-foreground">
          <ArrowLeft size={20} />
        </span>
        <div className="min-w-0 flex-1 space-y-[6px]">
          <Skeleton className={"h-[16px] w-[45%] " + bar} />
          <Skeleton className={"h-[10px] w-[65%] " + bar} />
        </div>
      </div>
      <Skeleton className={"mt-[8px] h-[10px] w-[40%] flex-none short:hidden " + bar} aria-hidden="true" />
      <div className="relative min-h-0 flex-1">
        <div className="pointer-events-none absolute inset-0 p-[22px]">
          <HistorySkeleton />
        </div>
      </div>
      <Skeleton className={"mt-[8px] h-[46px] flex-none rounded-full " + bar} aria-hidden="true" />
    </section>
  )
}
