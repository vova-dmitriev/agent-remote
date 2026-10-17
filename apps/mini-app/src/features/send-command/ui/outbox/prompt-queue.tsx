import { useTranslation } from "@/shared/lib/hooks"
import { COMMAND_IDS } from "@/features/send-command/config/test-ids"
import { PromptQueueItem } from "./prompt-queue-item"
import type { PromptQueueProps } from "./types"

export function PromptQueue({ queue }: PromptQueueProps) {
  const { t } = useTranslation()

  if (!queue.items.length) return null

  return (
    <div className="prompt-queue" data-testid={COMMAND_IDS.queue} aria-label={t("promptQueue")}>
      {queue.items.map((item) => (
        <PromptQueueItem key={item.command.commandId} item={item} queue={queue} />
      ))}
    </div>
  )
}
