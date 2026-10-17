import type { CommandController } from "@/features/send-command/model/use-command"

export interface PromptQueueProps {
  queue: CommandController["outbox"]
}
