import { DesktopBridgeError, HostKind } from "@protocol"
import type { DesktopBridge } from "@protocol"
import { DesktopApplicationClient, DesktopBridgeConnection } from "@/shared/api/desktop"
import type { HostAdapter } from "./types"

declare global {
  interface Window {
    desktopBridge?: DesktopBridge
  }
}

export function createDesktopHost(bridge: DesktopBridge | undefined = globalThis.window?.desktopBridge): HostAdapter {
  return {
    kind: HostKind.Desktop,
    capabilities: { pairDevice: false, revokeDevice: false, fullTab: false },
    createClient(handlers) {
      if (!bridge) throw new Error(DesktopBridgeError.Unavailable)

      return new DesktopApplicationClient(new DesktopBridgeConnection(bridge), handlers)
    },
  }
}
