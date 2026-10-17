import type { QueuedPrompt } from "@/entities/session"
import type { CommandController } from "../use-command"

export interface QueuedPromptEditorOptions {
  item: QueuedPrompt
  queue: Pick<CommandController["outbox"], "saveEdit" | "cancelEdit">
}
