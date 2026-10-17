import { Skeleton } from "@/shared/ui/skeleton"
import { STARTUP_IDS } from "./config/test-ids"

export function StartupSkeleton() {
  return (
    <main className="shell startup-skeleton" aria-busy="true" data-testid={STARTUP_IDS.root}>
      <Skeleton className="startup-header" />
      <Skeleton className="startup-title" />
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="startup-row" data-testid={STARTUP_IDS.row} />
      ))}
    </main>
  )
}
