import { ConnectionStatus, HostKind } from "@protocol"
import type { HostAdapter } from "@/shared/lib/host"
import { AppTransport } from "../api/transport/app-transport"

interface LinkedHostOptions {
  /** The server the client was linked to. */
  server: string
  /** The refresh credential the link code was exchanged for. */
  refresh: string
  /** Access was revoked or the credential expired: the client forgets the link. */
  onExpired: () => void
  openFullTab?: () => Promise<void>
  saveProviderFilter?: HostAdapter["saveProviderFilter"]
}

/**
 * A client linked to the server by a code from the Mini App (the Chrome extension): it talks to the server like the
 * Mini App does, signed in with the credential it keeps instead of Telegram's init data.
 */
export function linkedHost({ server, refresh, onExpired, openFullTab, saveProviderFilter }: LinkedHostOptions): HostAdapter {
  return {
    kind: HostKind.Chrome,
    capabilities: { pairDevice: true, revokeDevice: true, fullTab: !!openFullTab, linkClients: false },
    ...(openFullTab ? { openFullTab } : {}),
    ...(saveProviderFilter ? { saveProviderFilter } : {}),
    createClient: (handlers) =>
      new AppTransport(
        { refresh },
        {
          ...handlers,
          onConnection: (connection) => {
            if (connection === ConnectionStatus.Expired) onExpired()
            handlers.onConnection(connection)
          },
        },
        server,
      ),
  }
}
