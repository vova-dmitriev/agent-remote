import { memo } from "react"
import { HistoryDirection } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { PreviewSource } from "@/pages/session/config/message-navigation"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import { useMessagePreview } from "@/pages/session/model/use-message-preview"
import { useMessageRail } from "@/pages/session/model/rail/use-message-rail"
import type { MessageRailProps } from "@/pages/session/model/types/message-rail.types"
import { MessagePreview } from "../preview/message-preview"
import { HistoryCap } from "./history-cap"
import { RailMarker } from "./rail-marker"

/** A map of the whole loaded feed beside it: markers and the visible window share the native scrollbar's scale. */
export const MessageRail = memo(function MessageRail(props: MessageRailProps) {
  const { messages, jump, agent, older, newer, loadPage } = props
  const { t } = useTranslation()
  const preview = useMessagePreview(messages)
  const { track, groups, band, selectedId, selected, focus, register, onKeyDown, onTrackClick } = useMessageRail(props)

  return (
    <>
      <nav
        className="absolute inset-y-0 left-0 w-[40px]"
        data-testid={SESSION_FEED_IDS.rail}
        data-message-count={messages.length}
        data-active-message-id={selectedId}
        aria-label={t("messageNavigation")}
      >
        {older ? <HistoryCap direction={HistoryDirection.Before} loadPage={loadPage} /> : null}
        {/* Caps sit in their own column so the track keeps the scrollbar's full height and scale. */}
        <div ref={track} className="absolute inset-y-0 right-0 left-[16px]" data-testid={SESSION_FEED_IDS.railTrack}>
          {/* Like a native scrollbar track, the free track is a pointer-only shortcut; markers carry keyboard navigation. */}
          <Button
            variant="ghost"
            className="absolute inset-0 h-auto cursor-default rounded-none p-0 hover:bg-transparent dark:hover:bg-transparent"
            tabIndex={-1}
            aria-hidden="true"
            data-testid={SESSION_FEED_IDS.railSeek}
            onClick={onTrackClick}
          />
          <div
            className="pointer-events-none absolute inset-x-[3px] rounded-[4px] bg-muted"
            style={{ top: band.top, height: band.size }}
            data-testid={SESSION_FEED_IDS.railBand}
            aria-hidden="true"
          />
          {groups.map((group, index) => (
            <RailMarker
              key={messages[group.first]!.id}
              group={group}
              messages={messages}
              agent={agent}
              current={index === selected}
              preview={preview}
              register={register}
              focus={focus}
              jump={jump}
              onKeyDown={(event) => onKeyDown(event, index)}
            />
          ))}
        </div>
        {newer ? <HistoryCap direction={HistoryDirection.After} loadPage={loadPage} /> : null}
      </nav>
      {preview.message && preview.target ? (
        <MessagePreview
          id={preview.id}
          message={preview.message}
          anchor={preview.target.node}
          agent={agent}
          keep={preview.keep}
          leave={() => preview.hide(PreviewSource.Hover)}
        />
      ) : null}
    </>
  )
})
