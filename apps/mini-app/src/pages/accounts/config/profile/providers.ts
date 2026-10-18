import { AgentProvider } from "@protocol"

export const PROFILE_PROVIDERS = [
  { id: AgentProvider.Codex, label: "Codex · OpenAI", available: true },
  { id: AgentProvider.Claude, label: "Claude · Anthropic", available: false },
] as const
