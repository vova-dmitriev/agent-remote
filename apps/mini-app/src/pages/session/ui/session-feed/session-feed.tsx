import { ArrowDown } from "lucide-react"
import { SessionTab } from "@/entities/session"
import { HistoryStatus } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import { useFollowMessages } from "@/pages/session/model/use-follow-messages"
import { navigationScrollBehavior } from "@/pages/session/lib/message-navigation"
import type { SessionFeedProps } from "@/pages/session/model/types/session-feed.types"
import { MessageRail } from "./message-rail"
import { HistorySkeleton } from "./loading/history-skeleton"
import { FeedContent } from "./content/feed-content"

export function SessionFeed({
  sessionId,
  readingScope,
  onHistoryPage,
  messages,
  historyStatus = HistoryStatus.Ready,
  tab,
  terminal,
  agent,
}: SessionFeedProps) {
  const { scroll, content, settled, onScroll, onUserScroll, atBottom, activeId, jump, latest, virtualizer } = useFollowMessages(
    messages,
    tab === SessionTab.History,
    readingScope,
    historyStatus === HistoryStatus.Ready,
    onHistoryPage,
  )

  const { t } = useTranslation()
  const showMessages = tab === SessionTab.History && messages.length > 0
  const loading = tab === SessionTab.History && !messages.length && historyStatus === HistoryStatus.Loading

  return (
    <div className="feed-frame" data-testid={SESSION_FEED_IDS.frame} aria-busy={loading}>
      <div
        className={"feed" + (showMessages ? " with-rail" : "")}
        data-testid={SESSION_FEED_IDS.root}
        ref={scroll}
        style={showMessages && !settled ? { visibility: "hidden" } : undefined}
        onScroll={onScroll}
        onWheel={onUserScroll}
        onTouchStart={onUserScroll}
      >
        <div ref={content} data-testid={SESSION_FEED_IDS.content}>
          <FeedContent
            sessionId={sessionId}
            messages={messages}
            tab={tab}
            terminal={terminal}
            agent={agent}
            historyStatus={historyStatus}
            virtualizer={virtualizer}
          />
        </div>
      </div>
      {showMessages && !settled ? (
        <div className="feed-restoring">
          <HistorySkeleton />
        </div>
      ) : null}
      {showMessages && settled ? <MessageRail messages={messages} activeId={activeId} jump={jump} agent={agent} /> : null}
      {!atBottom ? (
        <Button
          variant="outline"
          size="icon"
          className="feed-bottom"
          data-testid={SESSION_FEED_IDS.bottom}
          aria-label={t("scrollToBottom")}
          title={t("scrollToBottom")}
          onClick={() => void latest(navigationScrollBehavior(window.matchMedia("(prefers-reduced-motion: reduce)").matches))}
        >
          <ArrowDown aria-hidden="true" size={18} />
        </Button>
      ) : null}
    </div>
  )
}
