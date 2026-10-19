import { MessageRole } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { PreviewSource, RAIL_HIT_SIZE } from "@/pages/session/config/message-navigation"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import type { RailMarkerProps } from "@/pages/session/model/types/message-rail.types"

/** Tick thickness; the tick marks the message the target jumps to. */
const TICK_SIZE = 3

/** One rail hit target: a single message or a run of messages too close to tell apart on the track. */
export function RailMarker({ group, messages, agent, current, preview, register, jump, onKeyDown }: RailMarkerProps) {
  const { t } = useTranslation()
  const message = messages[group.first]!
  const top = group.center - RAIL_HIT_SIZE / 2
  const members = messages.slice(group.first, group.last + 1)

  const label =
    group.first === group.last
      ? t("jumpToMessage", { number: group.first + 1, author: message.role === MessageRole.User ? t("you") : agent })
      : t("jumpToMessages", { first: group.first + 1, last: group.last + 1 })

  return (
    <Button
      ref={(node) => register(message.id, node)}
      variant="ghost"
      className="group/marker absolute left-0 flex w-full rounded-[4px] p-0 text-muted-foreground hover:text-muted-foreground aria-[current=true]:text-primary"
      style={{ top, height: RAIL_HIT_SIZE }}
      data-testid={SESSION_FEED_IDS.marker}
      data-message-id={message.id}
      data-message-ids={members.map((member) => member.id).join(" ")}
      data-message-count={members.length}
      aria-label={label}
      aria-describedby={preview.message?.id === message.id ? preview.id : undefined}
      aria-current={current ? "true" : undefined}
      tabIndex={current ? 0 : -1}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") preview.show(message.id, event.currentTarget, PreviewSource.Hover)
      }}
      onPointerMove={(event) => {
        if (event.pointerType === "touch") return
        preview.releaseHover()
        preview.show(message.id, event.currentTarget, PreviewSource.Hover)
      }}
      onPointerLeave={() => preview.hide(PreviewSource.Hover)}
      onFocus={(event) => {
        if (event.currentTarget.matches(":focus-visible")) preview.show(message.id, event.currentTarget, PreviewSource.Focus)
      }}
      onBlur={() => preview.hide(PreviewSource.Focus)}
      onClick={() => {
        preview.dismiss(message.id)
        jump(message.id)
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") preview.dismiss()
        else onKeyDown(event)
      }}
    >
      <span
        className="absolute left-[8px] block w-[12px] rounded-[1px] bg-current opacity-45 group-hover/marker:w-[18px] group-hover/marker:opacity-100 group-focus-visible/marker:w-[18px] group-focus-visible/marker:opacity-100 group-aria-[current=true]/marker:w-[18px] group-aria-[current=true]/marker:opacity-100"
        style={{ top: group.top - top - TICK_SIZE / 2, height: TICK_SIZE }}
        aria-hidden="true"
      />
    </Button>
  )
}
