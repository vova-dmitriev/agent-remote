import { DesktopBridgeError, HostKind } from "@protocol"
import type { DesktopBridge } from "@protocol"
import type { HostAdapter } from "@/shared/lib/host"
import { DesktopApplicationClient, DesktopBridgeConnection } from "../api/desktop"

declare global {
  interface Window {
    desktopBridge?: DesktopBridge
  }
}

export function createDesktopHost(bridge: DesktopBridge | undefined = globalThis.window?.desktopBridge): HostAdapter {
  return {
    kind: HostKind.Desktop,
    capabilities: { pairDevice: false, revokeDevice: false, fullTab: false, linkClients: false },
    createClient(handlers) {
      if (!bridge) throw new Error(DesktopBridgeError.Unavailable)

      return new DesktopApplicationClient(new DesktopBridgeConnection(bridge), handlers)
    },
  }
}
