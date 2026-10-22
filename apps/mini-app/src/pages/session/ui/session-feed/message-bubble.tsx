import { memo } from "react"
import { MessageRole } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { AttachmentCard, UnavailableAttachment } from "@/entities/attachment"
import { Markdown } from "@/shared/ui/markdown"
import { cn } from "@/shared/lib/utils"
import { displayMessage, messageTime } from "@/pages/session/lib/message-content"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import type { MessageBubbleProps } from "@/pages/session/model/types/message-bubble.types"
import { ToolActivityLine } from "./tool/tool-activity-line"

export const MessageBubble = memo(function MessageBubble({ message, agent, sessionId = "" }: MessageBubbleProps) {
  const { t, language } = useTranslation()

  // Tool calls of a subagent transcript render as compact activity lines, not as messages.
  if (message.tool)
    return <ToolActivityLine id={message.id} tool={message.tool} detail={message.tool.name === message.text ? "" : message.text} />
  const content = displayMessage(message)

  return (
    <article
      className={cn(messageClass, roleClass[message.role])}
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
      {message.role === MessageRole.Assistant && message.occurredAt > 0 ? (
        <time
          className="mt-[6px] block text-[11px] leading-none text-muted-foreground tabular-nums"
          dateTime={new Date(message.occurredAt).toISOString()}
          data-testid={SESSION_FEED_IDS.time}
        >
          {messageTime(message.occurredAt, language)}
        </time>
      ) : null}
    </article>
  )
})

const messageClass =
  "mb-[13px] rounded-[12px] border border-border bg-surface px-[19px] py-[18px] phone:p-[14px] session:w-fit session:max-w-[min(100%,72ch)] session:rounded-[20px] session:border-transparent session:px-[11px] session:py-[9px] [&>div]:mt-[9px] [&>div]:text-[14px] [&>div]:leading-[1.7] [&>div]:wrap-anywhere session:[&>div]:mt-0 session:[&>div]:text-[15px] session:[&>div]:leading-[1.55]"

const roleClass: Record<MessageRole, string> = {
  [MessageRole.User]:
    "ml-[45px] bg-highlight-subtle phone:ml-[20px] session:ml-auto session:max-w-[86%] session:bg-surface session:px-[16px] session:py-[12px]",
  [MessageRole.Assistant]: "session:bg-transparent session:px-0 session:py-[12px]",
}
