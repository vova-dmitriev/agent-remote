import type { QueuedPrompt } from "@/entities/session"
import type { PromptQueueProps } from "./types"

export interface PromptQueueItemProps extends PromptQueueProps {
  item: QueuedPrompt
}
