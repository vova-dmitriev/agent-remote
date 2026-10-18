import type { Session } from "@protocol"
import { agentName, useSessionStore } from "@/entities/session"
import { ProviderFilterValue } from "../config/values"
import { useHost } from "@/shared/lib/host"

export function useSessionFilter(sessions: Session[]) {
  const provider = useSessionStore((state) => state.providerFilter)
  const update = useSessionStore((state) => state.setProviderFilter)
  const host = useHost()

  const setProvider = (value: ProviderFilterValue) => {
    update(value)
    host.saveProviderFilter?.(value)
  }

  const filtered = provider === ProviderFilterValue.All ? sessions : sessions.filter((session) => agentName(session) === provider)

  return { provider, setProvider, filtered: [...filtered].sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)) }
}
