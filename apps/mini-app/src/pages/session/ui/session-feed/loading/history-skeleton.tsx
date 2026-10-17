import { useTranslation } from "@/shared/lib/hooks"
import { Skeleton } from "@/shared/ui/skeleton"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"

export function HistorySkeleton() {
  const { t } = useTranslation()

  return (
    <div
      className="space-y-7 overflow-hidden px-1 py-5"
      data-testid={SESSION_FEED_IDS.loading}
      role="status"
      aria-label={t("historyLoading")}
    >
      {[false, true, false].map((user, index) => (
        <div
          key={index}
          className={"space-y-3 rounded-2xl p-3 " + (user ? "ml-auto w-3/5 bg-muted/20" : "w-4/5")}
          data-testid={SESSION_FEED_IDS.skeletonMessage}
          aria-hidden="true"
        >
          <Skeleton className="h-3 w-24 motion-reduce:animate-none" />
          <Skeleton className="h-3 w-full motion-reduce:animate-none" />
          <Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  )
}
