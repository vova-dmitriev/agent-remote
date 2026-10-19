import { X } from "lucide-react"
import { CommandActionType } from "@protocol"
import { PromptStatus } from "@/entities/session"
import { useTranslation } from "@/shared/lib/hooks"
import { feedbackText, type MessageKey } from "@/shared/lib/i18n"
import { Button } from "@/shared/ui/button"
import { COMMAND_IDS } from "@/features/send-command/config/test-ids"
import { mutedTextClass } from "@/shared/ui/text"
import { QueuedPromptEditor } from "./editor/queued-prompt-editor"
import type { PromptQueueItemProps } from "./prompt-queue-item.types"

const statusKeys = {
  [PromptStatus.Queued]: "promptQueued",
  [PromptStatus.Editing]: "promptEditing",
  [PromptStatus.Sending]: "promptSending",
  [PromptStatus.Accepted]: "promptAccepted",
  [PromptStatus.Unknown]: "promptUnknown",
  [PromptStatus.Failed]: "promptFailed",
  [PromptStatus.Stale]: "promptStale",
} satisfies Record<PromptStatus, MessageKey>

export function PromptQueueItem({ item, queue }: PromptQueueItemProps) {
  const { t } = useTranslation()
  const id = item.command.commandId
  const canCancel = [PromptStatus.Queued, PromptStatus.Failed, PromptStatus.Stale].some((candidateValue) => candidateValue === item.status)

  return (
    <div
      className="flex flex-wrap items-center gap-x-[0.5rem] gap-y-[0.25rem] rounded-[0.75rem] border border-border px-[0.65rem] py-[0.4rem] text-[0.8rem]"
      data-testid={COMMAND_IDS.queuedItem}
      data-command-id={id}
      data-attachment-ids={
        item.command.action.type === CommandActionType.Prompt
          ? JSON.stringify(item.command.action.attachments?.map((attachment) => attachment.id) ?? [])
          : "[]"
      }
    >
      {item.status === PromptStatus.Editing ? (
        <QueuedPromptEditor item={item} queue={queue} />
      ) : (
        <span className="max-h-[3lh] flex-[1_1_100%] overflow-auto whitespace-pre-wrap wrap-anywhere" data-testid={COMMAND_IDS.queuedText}>
          {item.command.action.type === CommandActionType.Prompt ? item.command.action.text || t("promptAttachments") : ""}
        </span>
      )}
      {item.status === PromptStatus.Failed && item.code ? (
        <span className={mutedTextClass} data-testid={COMMAND_IDS.queuedError}>
          {feedbackText(item.code, t)}
        </span>
      ) : null}
      <span className={mutedTextClass} data-testid={COMMAND_IDS.queuedStatus}>
        {t(statusKeys[item.status])}
      </span>
      {item.status === PromptStatus.Queued ? (
        <>
          <Button type="button" variant="ghost" data-testid={COMMAND_IDS.editQueued} onClick={() => queue.beginEdit(id)}>
            {t("editQueuedPrompt")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            data-testid={COMMAND_IDS.sendQueuedNow}
            disabled={!queue.canSendNow(id)}
            onClick={() => queue.sendNow(id)}
          >
            {t("sendQueuedNow")}
          </Button>
        </>
      ) : null}
      {item.status === PromptStatus.Unknown || item.status === PromptStatus.Accepted ? (
        <Button type="button" variant="ghost" data-testid={COMMAND_IDS.checkQueued} onClick={() => queue.check(id)}>
          {t("checkDelivery")}
        </Button>
      ) : null}
      {item.status === PromptStatus.Unknown ? (
        <Button type="button" variant="ghost" data-testid={COMMAND_IDS.retryQueued} onClick={() => queue.retry(id)}>
          {t("retryCommand")}
        </Button>
      ) : null}
      {canCancel ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid={COMMAND_IDS.cancelQueued}
          aria-label={t("cancelQueuedPrompt")}
          onClick={() => queue.cancel(id)}
        >
          <X size={16} />
        </Button>
      ) : null}
    </div>
  )
}
