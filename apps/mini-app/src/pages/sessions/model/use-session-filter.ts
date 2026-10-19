import type { Session } from "@protocol"
import { filterByProvider, sortByRecency, useProviderFilter } from "@/entities/session"

export function useSessionFilter(sessions: Session[]) {
  const { provider, setProvider } = useProviderFilter()
  const filtered = filterByProvider(sessions, provider)

  return { provider, setProvider, filtered: sortByRecency(filtered) }
}
