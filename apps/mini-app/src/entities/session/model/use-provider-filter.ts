import { useHost } from "@/shared/lib/host"
import type { ProviderFilterValue } from "../config/session-values"
import { useSessionStore } from "./context/use-session-store"

/** The provider chips shared by the session list and the desktop sidebar, persisted through the host. */
export function useProviderFilter() {
  const provider = useSessionStore((state) => state.providerFilter)
  const update = useSessionStore((state) => state.setProviderFilter)
  const host = useHost()

  const setProvider = (value: ProviderFilterValue) => {
    update(value)
    host.saveProviderFilter?.(value)
  }

  return { provider, setProvider }
}
