import { SessionTab } from "@/entities/session"
import { HistoryStatus } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import { MessageBubble } from "../message-bubble"
import { HistorySkeleton } from "../loading/history-skeleton"
import type { FeedContentProps } from "./feed-content.types"

export function FeedContent({ sessionId, messages, tab, terminal, agent, historyStatus, virtualizer }: FeedContentProps) {
  const { t } = useTranslation()

  if (tab === SessionTab.Terminal)
    return <pre data-testid={SESSION_FEED_IDS.terminal}>{terminal?.sessionId === sessionId ? terminal.text : t("terminalWaiting")}</pre>

  if (messages.length)
    return (
      <div className="virtual-messages" data-testid={SESSION_FEED_IDS.virtualList} style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            ref={virtualizer.measureElement}
            className="virtual-message"
            data-testid={SESSION_FEED_IDS.virtualRow}
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
    <p className="placeholder" data-testid={SESSION_FEED_IDS.empty}>
      {t("emptyHistory")}
    </p>
  )
}
