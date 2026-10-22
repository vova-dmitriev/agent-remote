import { Search } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { CHAT_SEARCH_IDS } from "@/pages/session/config/test-ids"
import type { ChatSearchButtonProps } from "./chat-search.types"

/** The magnifier in the session's header that opens search in the chat; absent where the host cannot search. */
export function ChatSearchButton({ onOpen }: ChatSearchButtonProps) {
  const { t } = useTranslation()

  if (!onOpen) return null

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-[36px] flex-none text-muted-foreground hover:text-muted-foreground"
      aria-label={t("searchInChat")}
      title={t("searchInChat")}
      data-testid={CHAT_SEARCH_IDS.open}
      onClick={onOpen}
    >
      <Search aria-hidden="true" size={19} />
    </Button>
  )
}
