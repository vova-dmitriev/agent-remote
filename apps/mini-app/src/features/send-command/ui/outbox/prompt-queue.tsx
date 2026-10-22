import { useTranslation } from "@/shared/lib/hooks"
import { COMMAND_IDS } from "@/features/send-command/config/test-ids"
import { IN_FLIGHT_PROMPT_STATUSES } from "@/entities/session"
import { PromptQueueItem } from "./prompt-queue-item"
import type { PromptQueueProps } from "./types"

export function PromptQueue({ queue }: PromptQueueProps) {
  const { t } = useTranslation()
  // A prompt on its way to the agent already shows in the feed.
  const items = queue.items.filter((item) => !IN_FLIGHT_PROMPT_STATUSES.includes(item.status))

  if (!items.length) return null

  return (
    <div
      className="grid max-h-[min(12rem,25dvh)] gap-[0.4rem] overflow-auto pb-[0.5rem]"
      data-testid={COMMAND_IDS.queue}
      aria-label={t("promptQueue")}
    >
      {items.map((item) => (
        <PromptQueueItem key={item.command.commandId} item={item} queue={queue} />
      ))}
    </div>
  )
}
