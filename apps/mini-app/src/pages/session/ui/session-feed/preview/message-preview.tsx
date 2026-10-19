import { useMemo } from "react"
import { createPortal } from "react-dom"
import { MessageRole } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Markdown } from "@/shared/ui/markdown"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import { displayMessage } from "@/pages/session/lib/message-content"
import { previewText } from "@/pages/session/lib/preview-text"
import { useMessagePreviewPosition } from "@/pages/session/model/use-message-preview-position"
import { mutedTextClass } from "@/shared/ui/text"
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
      className="fixed z-50 max-h-[calc(100dvh_-_16px)] w-[min(360px,calc(100vw_-_16px))] overflow-hidden rounded-[12px] border border-border bg-surface px-[15px] py-[13px] text-foreground shadow-[0_6px_24px_color-mix(in_srgb,var(--foreground)_18%,transparent)]"
      data-testid={SESSION_FEED_IDS.preview}
      data-message-id={message.id}
      style={position}
      onPointerEnter={keep}
      onPointerLeave={leave}
      onPointerDown={(event) => event.preventDefault()}
    >
      <div className="mb-[7px] flex items-baseline justify-between gap-[12px] text-[12px]">
        <strong className="text-primary" data-testid={SESSION_FEED_IDS.previewAuthor}>
          {message.role === MessageRole.User ? t("you") : agent}
        </strong>
        {!Number.isNaN(date.getTime()) ? (
          <time className={mutedTextClass} dateTime={date.toISOString()} data-testid={SESSION_FEED_IDS.previewTime}>
            {timeFormat.format(date)}
          </time>
        ) : null}
      </div>
      <div className={previewContentClass} data-testid={SESSION_FEED_IDS.previewText}>
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

/** Denser rendered Markdown inside the hover preview. */
const previewContentClass = [
  "max-h-[min(260px,calc(100dvh_-_100px))] overflow-hidden text-[13px] leading-[1.5] wrap-anywhere",
  "[&_.message-markdown_:is(p,ul,ol,blockquote,table,pre)]:my-[0.45rem]",
  "[&_.message-markdown_:is(h1,h2,h3,h4,h5,h6)]:mt-[0.6rem] [&_.message-markdown_:is(h1,h2,h3,h4,h5,h6)]:mb-[0.3rem] [&_.message-markdown_:is(h1,h2,h3,h4,h5,h6)]:text-[14px]",
  "[&_.message-markdown_:is(p,li)]:whitespace-pre-line",
  "[&_.message-markdown>:first-child]:mt-0 [&_.message-markdown>:last-child]:mb-0",
].join(" ")
