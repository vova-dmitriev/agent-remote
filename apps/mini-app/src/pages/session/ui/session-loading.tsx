import { Skeleton } from "@/shared/ui/skeleton"
import { SESSION_PAGE_IDS } from "@/pages/session/config/test-ids"
import { HistorySkeleton } from "./session-feed/loading/history-skeleton"

/** The session page while a linked session waits for the first snapshot: its title and chat, loading. */
export function SessionLoading() {
  return (
    <section className="session:flex session:min-h-0 session:flex-1 session:flex-col" data-testid={SESSION_PAGE_IDS.loading}>
      <Skeleton className="mt-[12px] h-6 w-2/5 motion-reduce:animate-none" aria-hidden="true" />
      <HistorySkeleton />
    </section>
  )
}
