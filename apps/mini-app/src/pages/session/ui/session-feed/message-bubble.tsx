import { memo } from "react"
import { MessageRole } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { AttachmentCard, UnavailableAttachment } from "@/entities/attachment"
import { Markdown } from "@/shared/ui/markdown"
import { displayMessage } from "@/pages/session/lib/message-content"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import type { MessageBubbleProps } from "@/pages/session/model/types/message-bubble.types"

export const MessageBubble = memo(function MessageBubble({ message, agent, sessionId = "" }: MessageBubbleProps) {
  const { t } = useTranslation()
  const content = displayMessage(message)

  return (
    <article
      className={"message " + message.role}
      data-testid={SESSION_FEED_IDS.message}
      data-message-id={message.id}
      aria-label={message.role === MessageRole.User ? t("you") : agent}
    >
      <div data-testid={SESSION_FEED_IDS.text}>
        <Markdown text={content.text} />
      </div>
      {content.missingFiles.map((name, index) => (
        <UnavailableAttachment key={name + ":" + index} name={name} />
      ))}
      {message.attachments?.map((attachment) => (
        <AttachmentCard key={attachment.id} sessionId={sessionId} attachment={attachment} />
      ))}
    </article>
  )
})
