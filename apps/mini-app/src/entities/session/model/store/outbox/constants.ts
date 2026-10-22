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

/** A sent prompt shows in the feed at once under this id prefix, until the agent's own record of it arrives. */
export const PROMPT_ECHO_PREFIX = "echo:"
/** An echo the agent never records leaves the feed after this long. */
export const PROMPT_ECHO_TTL_MS = 120_000

/** A prompt on its way to the agent (sent, or accepted by the relay and not yet delivered): the feed shows it, not the queue. */
export const IN_FLIGHT_PROMPT_STATUSES: readonly PromptStatus[] = [PromptStatus.Sending, PromptStatus.Accepted]
