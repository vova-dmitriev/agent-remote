import { memo, useEffect } from "react"
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

/**
 * A Codex-style map of the loaded feed beside it: hairline ticks at the native scrollbar's scale. The mouse picks the
 * tick nearest to it, magnifies its neighbours and previews that message; a click on the rail jumps to it.
 */
export const MessageRail = memo(function MessageRail(props: MessageRailProps) {
  const { messages, jump, agent, older, newer, loadPage } = props
  const { t } = useTranslation()
  const preview = useMessagePreview(messages)
  const rail = useMessageRail(props)
  const { track, groups, gap, pointer, pointerHandlers, hoveredNode, hoveredMessage, selected, focus, register, onKeyDown } = rail

  useEffect(() => {
    if (hoveredMessage && hoveredNode) {
      preview.releaseHover()
      preview.show(hoveredMessage.id, hoveredNode, PreviewSource.Hover)
    } else {
      preview.hide(PreviewSource.Hover)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- preview's functions change identity every render
  }, [hoveredMessage, hoveredNode])

  return (
    <>
      <nav
        className="group/rail absolute inset-y-0 left-0 w-[40px]"
        data-testid={SESSION_FEED_IDS.rail}
        data-message-count={messages.length}
        data-active-message-id={rail.selectedId}
        aria-label={t("messageNavigation")}
      >
        {/* Pages beyond the loaded window: only shown while the pointer or focus is on the rail. */}
        <div className="opacity-0 transition-opacity group-focus-within/rail:opacity-100 group-hover/rail:opacity-100">
          {older ? <HistoryCap direction={HistoryDirection.Before} loadPage={loadPage} /> : null}
          {newer ? <HistoryCap direction={HistoryDirection.After} loadPage={loadPage} /> : null}
        </div>
        <div ref={track} className="absolute inset-y-0 right-0 left-[16px]" data-testid={SESSION_FEED_IDS.railTrack}>
          {/* The free track is a pointer-only shortcut to the nearest marker; markers carry keyboard navigation. */}
          <Button
            variant="ghost"
            className="absolute inset-0 h-auto cursor-default rounded-none p-0 hover:bg-transparent dark:hover:bg-transparent"
            tabIndex={-1}
            aria-hidden="true"
            {...pointerHandlers}
            onClick={() => {
              if (hoveredMessage) preview.dismiss(hoveredMessage.id)
              rail.onTrackClick()
            }}
          />
          {groups.map((group, index) => (
            <RailMarker
              key={messages[group.first]!.id}
              group={group}
              gap={gap}
              pointer={pointer}
              pointerHandlers={pointerHandlers}
              current={index === selected}
              messages={messages}
              agent={agent}
              preview={preview}
              register={register}
              focus={focus}
              jump={jump}
              onKeyDown={(event) => onKeyDown(event, index)}
            />
          ))}
        </div>
      </nav>
      {preview.message && preview.target ? (
        <MessagePreview
          id={preview.id}
          message={preview.message}
          anchor={preview.target.node}
          agent={agent}
          keep={preview.keep}
          leave={() => preview.hide(PreviewSource.Hover)}
          open={
            // Only a tapped preview is a way to its message; the mouse's preview stays a tooltip.
            preview.target.source === PreviewSource.Touch
              ? () => {
                  const target = preview.message!.id

                  preview.dismiss(target)
                  jump(target)
                }
              : undefined
          }
        />
      ) : null}
    </>
  )
})
