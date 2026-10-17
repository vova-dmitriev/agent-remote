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

export const ProviderFilterValue = {
  All: "all",
  Claude: AgentName.Claude,
  Codex: AgentName.Codex,
} as const

export type ProviderFilterValue = (typeof ProviderFilterValue)[keyof typeof ProviderFilterValue]
