import { HistoryPageSkip } from "@/shared/api"

export const SessionTab = {
  History: "history",
  Terminal: "terminal",
} as const

export type SessionTab = (typeof SessionTab)[keyof typeof SessionTab]

export const AgentName = {
  Claude: "Claude",
  Codex: "Codex",
} as const

export type AgentName = (typeof AgentName)[keyof typeof AgentName]

export const SessionActionType = { Logout: "logout" } as const

export type SessionActionType = (typeof SessionActionType)[keyof typeof SessionActionType]

/**
 * How a history page request ended. Loaded: a page was applied. Declined: the transport skipped it as Exhausted.
 * Busy and Stale: the transport's skips of the same names. Failed: no transport or an error. Only Loaded and
 * Declined can prove an edge exhausted.
 */
export const HistoryPageOutcome = {
  Loaded: "loaded",
  Declined: "declined",
  Busy: HistoryPageSkip.Busy,
  Stale: HistoryPageSkip.Stale,
  Failed: "failed",
} as const

export type HistoryPageOutcome = (typeof HistoryPageOutcome)[keyof typeof HistoryPageOutcome]

/** Status mark shared by the session list and the desktop sidebar. */
export const SessionStatusTone = {
  Running: "running",
  Attention: "attention",
  Idle: "idle",
  Unavailable: "unavailable",
} as const

export type SessionStatusTone = (typeof SessionStatusTone)[keyof typeof SessionStatusTone]

export { ProviderFilterValue } from "@protocol"
