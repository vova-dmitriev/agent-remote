import type { Session } from "@protocol"
import { filterByProvider, useProviderFilter } from "@/entities/session"

export function useSessionFilter(sessions: Session[]) {
  const { provider, setProvider } = useProviderFilter()
  const filtered = filterByProvider(sessions, provider)

  return { provider, setProvider, filtered: [...filtered].sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)) }
}
