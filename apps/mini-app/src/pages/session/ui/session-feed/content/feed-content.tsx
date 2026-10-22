import { PROMPT_ECHO_PREFIX, SessionTab } from "@/entities/session"
import { HistoryStatus } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import { MessageBubble } from "../message-bubble"
import { HistorySkeleton } from "../loading/history-skeleton"
import { cn } from "@/shared/lib/utils"
import type { FeedContentProps } from "./feed-content.types"

/** A sent prompt the agent has not recorded yet. */
const pending = (id: string) => id.startsWith(PROMPT_ECHO_PREFIX)

export function FeedContent({ sessionId, messages, tab, terminal, agent, historyStatus, virtualizer, available }: FeedContentProps) {
  const { t } = useTranslation()

  if (tab === SessionTab.Terminal)
    return <pre data-testid={SESSION_FEED_IDS.terminal}>{terminal?.sessionId === sessionId ? terminal.text : t("terminalWaiting")}</pre>

  if (messages.length)
    return (
      <div className="relative w-full" data-testid={SESSION_FEED_IDS.virtualList} style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            ref={virtualizer.measureElement}
            className={cn("absolute top-0 left-0 w-full *:mb-0", pending(messages[item.index]!.id) && "opacity-60")}
            data-testid={SESSION_FEED_IDS.virtualRow}
            data-pending={pending(messages[item.index]!.id) || undefined}
            data-index={item.index}
            data-message-id={messages[item.index]!.id}
            style={{ transform: `translateY(${item.start}px)` }}
          >
            <MessageBubble sessionId={sessionId} message={messages[item.index]!} agent={agent} />
          </div>
        ))}
      </div>
    )

  if (historyStatus === HistoryStatus.Loading) return <HistorySkeleton />
  if (historyStatus !== HistoryStatus.Ready) return null

  return (
    <p className="py-[20px] text-[13px] text-muted-foreground" data-testid={SESSION_FEED_IDS.empty}>
      {t(available ? "emptyHistory" : "disconnectedHistory")}
    </p>
  )
}
