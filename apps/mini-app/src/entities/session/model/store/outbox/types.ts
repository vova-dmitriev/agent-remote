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

/** A sent prompt the feed shows before the agent records it. */
export interface PromptEcho {
  commandId: string
  sessionId: string
  text: string
  sentAt: number
  /** The session's owner messages loaded when it was sent; a new one is the agent's record of a prompt. */
  known: string[]
  /** Echoes of the session still shown when it was sent: their records arrive first. */
  ahead: number
}
