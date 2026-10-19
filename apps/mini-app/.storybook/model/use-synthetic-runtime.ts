import { useLayoutEffect } from "react"
import { ConnectionStatus, FrameType, DeviceStatus, type Session } from "@protocol"
import { useSessionStoreApi } from "@/entities/session"
import { AppTransport } from "@/app/api"
import { useRuntime } from "@/shared/lib/runtime"

export function useSyntheticRuntime(session?: Session) {
  const store = useSessionStoreApi()
  const runtime = useRuntime()

  useLayoutEffect(() => {
    const transport = new AppTransport("synthetic", { onFrame: () => {}, onConnection: () => {} }, "http://api.storybook.local")
    const lease = runtime.attach(transport)

    store.getState().setConnection(ConnectionStatus.Online)

    if (session) {
      store.getState().receiveFrame({
        type: FrameType.Snapshot,
        deviceId: session.target.deviceId,
        connectors: [],
        snapshot: {
          sessions: [session],
          cursor: { streamId: "synthetic", seq: 0 },
          permissions: [],
          terminal: null,
          deviceStatus: DeviceStatus.Online,
        },
      })

      store.getState().setState((state) => ({ ...state, selectedId: session.id }))
    }

    return () => {
      runtime.clear(lease)
      transport.close()
    }
  }, [store, runtime, session])
}
