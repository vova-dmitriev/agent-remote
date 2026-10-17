import { memo } from "react"
import { PreviewSource } from "@/pages/session/config/message-navigation"
import { MessageRole } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import { useMessagePreview } from "@/pages/session/model/use-message-preview"
import { useMessageRail } from "@/pages/session/model/use-message-rail"
import type { MessageRailProps } from "@/pages/session/model/types/message-rail.types"
import { MessagePreview } from "./preview/message-preview"

export const MessageRail = memo(function MessageRail({ messages, activeId, jump, agent }: MessageRailProps) {
  const { t } = useTranslation()
  const preview = useMessagePreview(messages)
  const { rail, selected, register, onKeyDown } = useMessageRail(messages, activeId, jump)

  return (
    <>
      <nav ref={rail} className="message-rail" data-testid={SESSION_FEED_IDS.rail} aria-label={t("messageNavigation")}>
        {messages.map((message, index) => (
          <Button
            key={message.id}
            ref={(node) => register(message.id, node)}
            variant="ghost"
            className="message-marker"
            data-testid={SESSION_FEED_IDS.marker}
            data-message-id={message.id}
            aria-label={t("jumpToMessage", { number: index + 1, author: message.role === MessageRole.User ? t("you") : agent })}
            aria-describedby={preview.message?.id === message.id ? preview.id : undefined}
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
            aria-current={selected === message.id ? "true" : undefined}
            tabIndex={selected === message.id ? 0 : -1}
            onClick={() => {
              preview.dismiss(message.id)
              jump(message.id)
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") preview.dismiss()
              else onKeyDown(event, index)
            }}
          >
            <span aria-hidden="true" />
          </Button>
        ))}
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
