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

/**
 * How a history page request ended. Loaded: the transport returned a page and it was applied. Declined: the
 * transport made no request because it holds no cursor for that edge (the end was reached), already found the
 * edge exhausted, or has a request for it in flight. Failed: no transport, a stale selection or an error.
 */
export const HistoryPageOutcome = { Loaded: "loaded", Declined: "declined", Failed: "failed" } as const

export type HistoryPageOutcome = (typeof HistoryPageOutcome)[keyof typeof HistoryPageOutcome]

export type SessionActionType = (typeof SessionActionType)[keyof typeof SessionActionType]

export { ProviderFilterValue } from "@protocol"
