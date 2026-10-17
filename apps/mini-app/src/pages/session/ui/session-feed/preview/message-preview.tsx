import { useMemo } from "react"
import { createPortal } from "react-dom"
import { MessageRole } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Markdown } from "@/shared/ui/markdown"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import { displayMessage } from "@/pages/session/lib/message-content"
import { previewText } from "@/pages/session/lib/preview-text"
import { useMessagePreviewPosition } from "@/pages/session/model/use-message-preview-position"
import type { MessagePreviewProps } from "./message-preview.types"

export function MessagePreview({ id, message, anchor, agent, keep, leave }: MessagePreviewProps) {
  const { t, language } = useTranslation()
  const { root, position } = useMessagePreviewPosition(anchor)
  const timeFormat = useMemo(() => new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }), [language])
  const date = new Date(message.occurredAt)
  const content = displayMessage(message)

  return createPortal(
    <div
      ref={root}
      id={id}
      role="tooltip"
      className="message-preview"
      data-testid={SESSION_FEED_IDS.preview}
      data-message-id={message.id}
      style={position}
      onPointerEnter={keep}
      onPointerLeave={leave}
      onPointerDown={(event) => event.preventDefault()}
    >
      <div className="message-preview-heading">
        <strong data-testid={SESSION_FEED_IDS.previewAuthor}>{message.role === MessageRole.User ? t("you") : agent}</strong>
        {!Number.isNaN(date.getTime()) ? (
          <time dateTime={date.toISOString()} data-testid={SESSION_FEED_IDS.previewTime}>
            {timeFormat.format(date)}
          </time>
        ) : null}
      </div>
      <div className="message-preview-content" data-testid={SESSION_FEED_IDS.previewText}>
        <Markdown
          text={previewText(
            content.text || [...content.missingFiles, ...(message.attachments?.map((attachment) => attachment.name) ?? [])].join("\n"),
          )}
          variant="preview"
        />
      </div>
    </div>,
    document.body,
  )
}
