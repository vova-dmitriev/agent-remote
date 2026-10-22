import { Search } from "lucide-react"
import { ConnectionStatus, DeviceStatus } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { DropdownItem, menuItemClass } from "@/shared/ui/dropdown"
import { CHAT_SEARCH_IDS } from "@/pages/session/config/test-ids"
import { SessionActions } from "@/features/send-command"
import { RemoveSessionItems } from "@/features/remove-session"
import type { SessionMenuProps } from "../session-page.types"

/** The session's "…" menu: searching the chat, interrupting the agent, and removing the session when the page can. */
export function SessionMenu({ session, controller, remove, connection, deviceStatus, onRemoved, onSearch }: SessionMenuProps) {
  const { t } = useTranslation()

  return (
    <SessionActions session={session} controller={controller} connection={connection} deviceStatus={deviceStatus}>
      {onSearch ? (
        <DropdownItem asChild onSelect={onSearch}>
          <Button type="button" variant="ghost" className={menuItemClass} data-testid={CHAT_SEARCH_IDS.open}>
            <Search aria-hidden="true" size={16} />
            {t("searchInChat")}
          </Button>
        </DropdownItem>
      ) : null}
      {remove ? (
        <RemoveSessionItems
          session={session}
          controller={remove}
          disabled={connection !== ConnectionStatus.Online || deviceStatus !== DeviceStatus.Online}
          onRemoved={onRemoved}
        />
      ) : null}
    </SessionActions>
  )
}
