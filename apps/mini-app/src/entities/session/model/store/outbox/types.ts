import type { ClientCommand } from "@protocol"
import type { PromptStatus } from "./constants"

export type { PromptStatus } from "./constants"

export interface PromptIntent {
  command: ClientCommand
  streamId: string
  runtimeEpoch: number
  files: File[]
}

export interface QueuedPrompt extends PromptIntent {
  status: PromptStatus
  code?: string | undefined
}
