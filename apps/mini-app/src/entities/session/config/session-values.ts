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

/** Status mark shared by the session list and the desktop sidebar. */
export const SessionStatusTone = {
  Running: "running",
  Attention: "attention",
  Idle: "idle",
  Unavailable: "unavailable",
} as const

export type SessionStatusTone = (typeof SessionStatusTone)[keyof typeof SessionStatusTone]

export { ProviderFilterValue } from "@protocol"
