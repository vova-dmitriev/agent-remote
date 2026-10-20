import { Skeleton } from "@/shared/ui/skeleton"
import { STARTUP_IDS } from "../config/test-ids"

export function StartupSkeleton() {
  return (
    <main
      className="m-auto max-w-[820px] px-[18px] pt-[calc(10px+env(safe-area-inset-top))] pb-[calc(16px+env(safe-area-inset-bottom))] phone:px-[14px]"
      aria-busy="true"
      data-testid={STARTUP_IDS.root}
    >
      <Skeleton className="mb-[24px] h-[40px] w-full" />
      <Skeleton className="mb-[36px] h-[32px] w-[55%]" />
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="mb-[24px] h-[48px] w-full" data-testid={STARTUP_IDS.row} />
      ))}
    </main>
  )
}
