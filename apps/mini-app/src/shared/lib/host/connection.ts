import { ConnectionStatus, ErrorCode, FrameType, LOCAL_AUTH_ERROR_CODES } from "@protocol"
import type { TransportHandlers } from "@/shared/api"
import type { RuntimeLease, TransportRuntime } from "@/shared/lib/runtime"
import type { HostAdapter } from "./types"

export function connectHost(host: HostAdapter, runtime: TransportRuntime, handlers: TransportHandlers) {
  let lease: RuntimeLease | null = null
  let connection: ConnectionStatus = ConnectionStatus.Connecting
  const current = () => runtime.isCurrent(lease)

  try {
    const client = host.createClient({
      onConnection: (value) => {
        if (current()) {
          connection = value
          handlers.onConnection(value)
        }
      },
      onFrame: (frame) => {
        if (current()) handlers.onFrame(frame)
      },
      onHistory: (sessionId, events) => {
        if (current()) handlers.onHistory?.(sessionId, events)
      },
      onHistoryStatus: (sessionId, status) => {
        if (current()) handlers.onHistoryStatus?.(sessionId, status)
      },
    })

    lease = runtime.attach(client)

    void client.start().catch((error: unknown) => {
      if (current()) {
        const code = error instanceof Error ? error.message : ErrorCode.REQUEST_FAILED

        handlers.onFrame({ type: FrameType.Error, code })

        if (connection !== ConnectionStatus.Offline) {
          const expired = code === ErrorCode.TELEGRAM_AUTH_FAILED || LOCAL_AUTH_ERROR_CODES.some((value) => value === code)

          handlers.onConnection(expired ? ConnectionStatus.Expired : ConnectionStatus.Offline)
        }
      }
    })

    return () => {
      if (lease) runtime.clear(lease)
      client.close()
    }
  } catch (error) {
    handlers.onConnection(ConnectionStatus.Expired)
    handlers.onFrame({ type: FrameType.Error, code: error instanceof Error ? error.message : ErrorCode.REQUEST_FAILED })

    return () => {}
  }
}
