import { Pin, PinOff } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { DropdownItem, menuItemClass } from "@/shared/ui/dropdown"
import { SESSION_PAGE_IDS } from "@/pages/session/config/test-ids"
import type { PinSessionItemProps } from "../session-page.types"

/** Pins the session to the top of the lists, or unpins it: the phone's way to pin, where the sidebar's control is absent. */
export function PinSessionItem({ pinned, onToggle }: PinSessionItemProps) {
  const { t } = useTranslation()

  return (
    <DropdownItem asChild onSelect={onToggle}>
      <Button type="button" variant="ghost" className={menuItemClass} data-testid={SESSION_PAGE_IDS.pin} data-pinned={pinned}>
        {pinned ? <PinOff aria-hidden="true" size={16} /> : <Pin aria-hidden="true" size={16} />}
        {t(pinned ? "unpinSession" : "pinSession")}
      </Button>
    </DropdownItem>
  )
}
