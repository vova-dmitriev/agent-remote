import { ArrowDown } from "lucide-react"
import { SessionTab } from "@/entities/session"
import { HistoryStatus, type HistoryMessage } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import { useFollowMessages } from "@/pages/session/model/use-follow-messages"
import { useHistoryEdges } from "@/pages/session/model/history/use-history-edges"
import { useRailMap } from "@/pages/session/model/rail/use-rail-map"
import { navigationScrollBehavior } from "@/pages/session/lib/message-navigation"
import { useOutlineJump } from "@/pages/session/model/history/use-outline-jump"
import { railActiveId } from "@/pages/session/lib/history/subagent-history"
import { railMarks } from "@/pages/session/lib/history/rail-marks"
import type { SessionFeedProps } from "@/pages/session/model/types/session-feed.types"
import { MessageRail } from "./rail/message-rail"
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
  newestAt,
  outline = NO_OUTLINE,
  onHistoryAround,
}: SessionFeedProps) {
  const edges = useHistoryEdges(messages, onHistoryPage, newestAt)

  const { scroll, content, settled, onScroll, onUserScroll, atBottom, activeId, jump, latest, virtualizer } = useFollowMessages(
    messages,
    tab === SessionTab.History,
    readingScope,
    historyStatus === HistoryStatus.Ready,
    edges.page,
  )

  const outlineJump = useOutlineJump(messages, outline, jump, onHistoryAround)
  const { t } = useTranslation()
  const showMessages = tab === SessionTab.History && messages.length > 0
  const map = useRailMap(virtualizer, scroll, content, showMessages && settled)
  const loading = tab === SessionTab.History && !messages.length && historyStatus === HistoryStatus.Loading
  // The feed hides behind a skeleton while it restores its reading line or loads the window a rail tap asked for.
  const covered = showMessages && (!settled || outlineJump.pending !== null)

  return (
    <div className="relative isolate session:min-h-0 session:flex-1" data-testid={SESSION_FEED_IDS.frame} aria-busy={loading}>
      <div
        className={cn(feedClass, showMessages && "py-0 pl-[47px] session:py-0")}
        data-testid={SESSION_FEED_IDS.root}
        ref={scroll}
        style={covered ? { visibility: "hidden" } : undefined}
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
      {covered ? (
        <div className="pointer-events-none absolute inset-0 p-[22px]">
          <HistorySkeleton />
        </div>
      ) : null}
      {showMessages && settled ? (
        <MessageRail
          {...railMarks(messages, map, outline)}
          loaded={messages.length}
          activeId={outlineJump.pending ?? railActiveId(messages, activeId)}
          jump={outlineJump.reach}
          older={edges.older}
          newer={edges.newer}
          loadPage={edges.page}
          agent={agent}
        />
      ) : null}
      {!atBottom ? (
        <Button
          variant="outline"
          size="icon"
          className="absolute bottom-[16px] left-1/2 size-[40px] -translate-x-1/2 rounded-full bg-surface text-foreground shadow-[0_3px_12px_color-mix(in_srgb,var(--foreground)_15%,transparent)] hover:bg-surface hover:text-foreground dark:bg-surface dark:hover:bg-surface"
          data-testid={SESSION_FEED_IDS.bottom}
          aria-label={t("scrollToBottom")}
          title={t("scrollToBottom")}
          onClick={() =>
            void latest(navigationScrollBehavior(window.matchMedia("(prefers-reduced-motion: reduce)").matches), !edges.newest)
          }
        >
          <ArrowDown aria-hidden="true" size={18} />
        </Button>
      ) : null}
    </div>
  )
}

const NO_OUTLINE: HistoryMessage[] = []

const feedClass =
  "h-[44dvh] min-h-[240px] overflow-y-auto overscroll-y-contain px-0 py-[22px] [overflow-anchor:none] [scrollbar-width:thin] phone:h-[40dvh] session:h-full session:min-h-0 session:py-[12px]"
