import { Pin, PinOff } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { cn } from "@/shared/lib/utils"
import { SESSION_SIDEBAR_IDS } from "@/widgets/session-sidebar/config/test-ids"
import type { SidebarPinButtonProps } from "./list.types"

/**
 * The pointer's pin control, shown on row hover or while pinned. A listbox option holds no controls, so this is a
 * plain marked icon: the row's click handler pins when the click lands on it, the list's P key pins from the
 * keyboard, and the row announces its pinned state.
 */
export function SidebarPinButton({ pinned }: SidebarPinButtonProps) {
  const { t } = useTranslation()

  return (
    <span
      aria-hidden="true"
      data-testid={SESSION_SIDEBAR_IDS.rowPin}
      data-pin-control
      data-pinned={pinned}
      title={t(pinned ? "unpinSession" : "pinSession") + " (P)"}
      className={cn(
        "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-muted hover:text-foreground",
        pinned && "opacity-100",
      )}
    >
      {pinned ? <PinOff size={14} /> : <Pin size={14} />}
    </span>
  )
}
