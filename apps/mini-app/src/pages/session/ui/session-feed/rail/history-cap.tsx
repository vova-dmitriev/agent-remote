import { HistoryDirection } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import type { HistoryCapProps } from "@/pages/session/model/types/message-rail.types"

/** A thin end of the rail that stands for history beyond the loaded window and loads the next page. */
export function HistoryCap({ direction, loadPage }: HistoryCapProps) {
  const { t } = useTranslation()
  const label = t(direction === HistoryDirection.Before ? "loadEarlierMessages" : "loadLaterMessages")

  return (
    <Button
      variant="ghost"
      className="flex h-[12px] w-full shrink-0 items-center rounded-[3px] p-0 text-muted-foreground hover:text-primary"
      data-testid={SESSION_FEED_IDS.railCap}
      data-direction={direction}
      aria-label={label}
      title={label}
      onClick={() => loadPage(direction)}
    >
      <span className="block w-[12px] border-t-2 border-dotted border-current" aria-hidden="true" />
    </Button>
  )
}
