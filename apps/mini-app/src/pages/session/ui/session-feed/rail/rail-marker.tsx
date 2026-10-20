import { MessageRole } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { PreviewSource, RailTick } from "@/pages/session/config/message-navigation"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import { tickMagnification } from "@/pages/session/lib/rail-layout"
import type { RailMarkerProps } from "@/pages/session/model/types/message-rail.types"

/**
 * One rail marker: a hairline tick for a message or a run of messages too close to tell apart. The rail handles the
 * mouse (nearest tick, magnification); the button carries keyboard focus, touch taps and the accessible name.
 */
export function RailMarker({
  group,
  gap,
  pointer,
  pointerHandlers,
  current,
  messages,
  agent,
  preview,
  register,
  focus,
  jump,
  onKeyDown,
}: RailMarkerProps) {
  const { t } = useTranslation()
  const message = messages[group.first]!
  const top = group.center - gap / 2
  const members = messages.slice(group.first, group.last + 1)
  const grow = tickMagnification(group.top, pointer)

  const label =
    group.first === group.last
      ? t("jumpToMessage", { number: group.first + 1, author: message.role === MessageRole.User ? t("you") : agent })
      : t("jumpToMessages", { first: group.first + 1, last: group.last + 1 })

  return (
    <Button
      ref={(node) => register(message.id, node)}
      variant="ghost"
      className="group/marker absolute left-0 flex w-full rounded-none p-0 hover:bg-transparent focus-visible:ring-0 dark:hover:bg-transparent"
      style={{ top, height: gap }}
      data-testid={SESSION_FEED_IDS.marker}
      data-message-id={message.id}
      data-message-ids={members.map((member) => member.id).join(" ")}
      data-message-count={members.length}
      aria-label={label}
      aria-describedby={preview.message?.id === message.id ? preview.id : undefined}
      aria-current={current ? "true" : undefined}
      tabIndex={current ? 0 : -1}
      {...pointerHandlers}
      onFocus={(event) => {
        focus.enter(message.id)
        if (event.currentTarget.matches(":focus-visible")) preview.show(message.id, event.currentTarget, PreviewSource.Focus)
      }}
      onBlur={(event) => {
        focus.leave(event)
        preview.hide(PreviewSource.Focus)
      }}
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
        className="absolute left-[6px] block rounded-full bg-foreground transition-[width,opacity] duration-100 ease-out group-focus-visible/marker:w-[22px]! group-focus-visible/marker:opacity-100!"
        style={{
          top: group.top - top - RailTick.Height / 2,
          height: RailTick.Height,
          width: RailTick.Width + (RailTick.HoverWidth - RailTick.Width) * grow,
          opacity: 0.22 + 0.78 * grow,
        }}
        data-testid={SESSION_FEED_IDS.railTick}
        aria-hidden="true"
      />
    </Button>
  )
}
