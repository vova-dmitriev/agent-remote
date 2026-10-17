import type { Session } from "@protocol"
import { agentName, useSessionStore } from "@/entities/session"
import { ProviderFilterValue } from "../config/values"

export function useSessionFilter(sessions: Session[]) {
  const provider = useSessionStore((state) => state.providerFilter)
  const setProvider = useSessionStore((state) => state.setProviderFilter)
  const filtered = provider === ProviderFilterValue.All ? sessions : sessions.filter((session) => agentName(session) === provider)

  return { provider, setProvider, filtered: [...filtered].sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)) }
}
