import { ArrowDown } from "lucide-react"
import { SessionTab } from "@/entities/session"
import { HistoryStatus } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
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
  available = true,
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
    <div className="relative isolate session:min-h-0 session:flex-1" data-testid={SESSION_FEED_IDS.frame} aria-busy={loading}>
      <div
        className={cn(feedClass, showMessages && "py-0 pr-[35px] session:py-0")}
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
            available={available}
            virtualizer={virtualizer}
          />
        </div>
      </div>
      {showMessages && !settled ? (
        <div className="pointer-events-none absolute inset-0 p-[22px]">
          <HistorySkeleton />
        </div>
      ) : null}
      {showMessages && settled ? <MessageRail messages={messages} activeId={activeId} jump={jump} agent={agent} /> : null}
      {!atBottom ? (
        <Button
          variant="outline"
          size="icon"
          className="absolute bottom-[16px] left-1/2 size-[40px] -translate-x-1/2 rounded-full bg-surface text-foreground shadow-[0_3px_12px_color-mix(in_srgb,var(--foreground)_15%,transparent)] hover:bg-surface hover:text-foreground dark:bg-surface dark:hover:bg-surface"
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

const feedClass =
  "h-[44dvh] min-h-[240px] overflow-y-auto overscroll-y-contain px-0 py-[22px] [overflow-anchor:none] [scrollbar-width:thin] phone:h-[40dvh] session:h-full session:min-h-0 session:py-[12px]"
