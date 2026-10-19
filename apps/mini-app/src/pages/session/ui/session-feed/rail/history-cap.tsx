import { ChevronsDown, ChevronsUp } from "lucide-react"
import { HistoryDirection } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import { RAIL_HIT_SIZE } from "@/pages/session/config/message-navigation"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import type { HistoryCapProps } from "@/pages/session/model/types/message-rail.types"

/** Stands for history beyond the loaded window at one end of the rail, beside the track, and loads the next page. */
export function HistoryCap({ direction, loadPage }: HistoryCapProps) {
  const { t } = useTranslation()
  const earlier = direction === HistoryDirection.Before
  const label = t(earlier ? "loadEarlierMessages" : "loadLaterMessages")
  const Icon = earlier ? ChevronsUp : ChevronsDown

  return (
    <Button
      variant="ghost"
      className={cn(
        "absolute left-0 flex w-[16px] items-center rounded-[4px] p-0 text-muted-foreground hover:text-primary has-[>svg]:px-0",
        earlier ? "top-0" : "bottom-0",
      )}
      style={{ height: RAIL_HIT_SIZE }}
      data-testid={SESSION_FEED_IDS.railCap}
      data-direction={direction}
      aria-label={label}
      title={label}
      onClick={() => loadPage(direction)}
    >
      <Icon className="size-[14px]" aria-hidden="true" />
    </Button>
  )
}
