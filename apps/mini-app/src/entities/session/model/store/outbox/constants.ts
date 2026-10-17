export const PROMPT_OUTBOX_LIMIT = 20
export const PROMPT_OUTBOX_BYTES = 80 * 1024 * 1024
export const PROMPT_RECEIPT_POLL_MS = 2000

export const PromptStatus = {
  Queued: "queued",
  Editing: "editing",
  Sending: "sending",
  Accepted: "accepted",
  Unknown: "unknown",
  Failed: "failed",
  Stale: "stale",
} as const

export type PromptStatus = (typeof PromptStatus)[keyof typeof PromptStatus]
