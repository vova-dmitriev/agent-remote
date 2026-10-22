import type { HostKind, ProviderFilterValue } from "@protocol"
import type { ApplicationClient, TransportHandlers } from "@/shared/api"

interface HostCapabilities {
  readonly pairDevice: boolean
  readonly revokeDevice: boolean
  readonly fullTab: boolean
  /** Issues codes that link the Chrome extension to this owner (the Telegram Mini App). */
  readonly linkClients: boolean
}

export interface HostAdapter {
  readonly kind: HostKind
  readonly capabilities: HostCapabilities
  createClient(handlers: TransportHandlers): ApplicationClient
  openFullTab?(): Promise<void>
  saveProviderFilter?(filter: ProviderFilterValue): void
}
