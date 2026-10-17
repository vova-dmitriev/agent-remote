import type { QueuedPrompt } from "@/entities/session"
import type { PromptQueueProps } from "../types"

export interface QueuedPromptEditorProps extends PromptQueueProps {
  item: QueuedPrompt
}
