import { MessageRole } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { CHAT_SEARCH_IDS } from "@/pages/session/config/test-ids"
import { matchParts } from "@/pages/session/lib/history/chat-search"
import type { ChatSearchResultProps } from "./chat-search.types"

/** One found message: who wrote it and its snippet with the words marked. */
export function ChatSearchResult({ message, query, agent, onPick }: ChatSearchResultProps) {
  const { t } = useTranslation()

  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto w-full flex-col items-start gap-[2px] rounded-[10px] px-[10px] py-[7px] text-left whitespace-normal"
      data-testid={CHAT_SEARCH_IDS.result}
      data-message-id={message.id}
      onClick={() => onPick(message)}
    >
      <span className="text-[12px] text-muted-foreground">{message.role === MessageRole.User ? t("you") : agent}</span>
      <span className="line-clamp-2 text-[13px] leading-[1.45] wrap-anywhere">
        {matchParts(message.text, query).map((part, index) =>
          part.match ? (
            <mark key={index} className="rounded-[3px] bg-warning/25 text-foreground" data-testid={CHAT_SEARCH_IDS.match}>
              {part.text}
            </mark>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </span>
    </Button>
  )
}
