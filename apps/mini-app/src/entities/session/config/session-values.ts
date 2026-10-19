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
 * How a history page request ended. Loaded: a page was applied. Declined: the transport holds no cursor for that
 * edge (the end was reached) or already found it exhausted. Busy: a request for that edge was in flight. Stale:
 * the selection, socket or session generation changed. Failed: no transport or an error. Only Loaded and
 * Declined can prove an edge exhausted.
 */
export const HistoryPageOutcome = {
  Loaded: "loaded",
  Declined: "declined",
  Busy: "busy",
  Stale: "stale",
  Failed: "failed",
} as const

export type HistoryPageOutcome = (typeof HistoryPageOutcome)[keyof typeof HistoryPageOutcome]

export { ProviderFilterValue } from "@protocol"
