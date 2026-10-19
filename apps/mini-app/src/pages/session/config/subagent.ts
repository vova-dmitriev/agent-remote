import { ErrorCode, SubagentStatus } from "@protocol"
import type { MessageKey } from "@/shared/lib/i18n"

/** How often an open subagent view re-reads the transcript tail while the subagent runs and the page is visible. */
export const SUBAGENT_POLL_INTERVAL_MS = 4_000

/** Longest wait between re-reads after consecutive failures; each failure doubles the interval up to it. */
export const SUBAGENT_POLL_BACKOFF_MAX_MS = 60_000

/** Transcript items one subagent view keeps; older pages beyond it are dropped from the far end. */
export const SUBAGENT_MESSAGE_LIMIT = 1_000

export const SubagentHistoryStatus = {
  Loading: "loading",
  Ready: "ready",
  Unavailable: "unavailable",
  Failed: "failed",
} as const
export type SubagentHistoryStatus = (typeof SubagentHistoryStatus)[keyof typeof SubagentHistoryStatus]

/** Errors that mean this subagent has no readable transcript, as opposed to a transient failure; polling stops on them. */
export const SUBAGENT_UNAVAILABLE_CODES: readonly ErrorCode[] = [
  ErrorCode.NOT_FOUND,
  ErrorCode.TRANSCRIPT_UNAVAILABLE,
  ErrorCode.CAPABILITY_UNAVAILABLE,
]

/** Subagent states that can still append to the transcript. */
export const SUBAGENT_ACTIVE_STATUSES: readonly SubagentStatus[] = [
  SubagentStatus.Queued,
  SubagentStatus.Running,
  SubagentStatus.WaitingInput,
  SubagentStatus.Unknown,
]

export const SUBAGENT_STATUS_LABELS = {
  [SubagentStatus.Queued]: "subagentQueued",
  [SubagentStatus.Running]: "statusRunning",
  [SubagentStatus.WaitingInput]: "statusInput",
  [SubagentStatus.Completed]: "subagentCompleted",
  [SubagentStatus.Failed]: "subagentFailed",
  [SubagentStatus.Stopped]: "subagentStopped",
  [SubagentStatus.Unknown]: "statusUnknown",
} as const satisfies Record<SubagentStatus, MessageKey>
