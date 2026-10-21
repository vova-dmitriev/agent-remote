import { useMemo } from "react"
import { MessageRole } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Markdown } from "@/shared/ui/markdown"
import { mutedTextClass } from "@/shared/ui/text"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import { displayMessage } from "@/pages/session/lib/message-content"
import { previewText } from "@/pages/session/lib/preview-text"
import type { PreviewBodyProps } from "./message-preview.types"

/** A marker preview's author, time and first lines of the message. */
export function PreviewBody({ message, agent }: PreviewBodyProps) {
  const { t, language } = useTranslation()
  const timeFormat = useMemo(() => new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }), [language])
  const date = new Date(message.occurredAt)
  const content = displayMessage(message)

  return (
    <>
      <div className="mb-[4px] flex items-baseline justify-between gap-[12px] text-[12px]">
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
    </>
  )
}

/** Denser rendered Markdown inside the hover preview, cut to three lines like Codex. */
const previewContentClass = [
  "line-clamp-3 text-[13px] leading-[1.5] wrap-anywhere",
  "[&_.message-markdown_:is(p,ul,ol,blockquote,table,pre)]:my-[0.45rem]",
  "[&_.message-markdown_:is(h1,h2,h3,h4,h5,h6)]:mt-[0.6rem] [&_.message-markdown_:is(h1,h2,h3,h4,h5,h6)]:mb-[0.3rem] [&_.message-markdown_:is(h1,h2,h3,h4,h5,h6)]:text-[14px]",
  "[&_.message-markdown_:is(p,li)]:whitespace-pre-line",
  "[&_.message-markdown>:first-child]:mt-0 [&_.message-markdown>:last-child]:mb-0",
].join(" ")
