import { useEffect } from "react"
import { ConnectionStatus, HistoryStatus, ErrorCode } from "@protocol"
import { AppTransport } from "@/shared/api"
import { useRuntime } from "@/shared/lib/runtime"
import { telegram } from "@/shared/lib/telegram"
import { useSessionStore, useSessionStoreApi } from "./context/use-session-store"

export function useSessionConnection() {
  const store = useSessionStoreApi()
  const runtime = useRuntime()
  const state = useSessionStore((current) => current.session)
  const error = useSessionStore((current) => current.error)
  const result = useSessionStore((current) => current.result)
  const { setError, setResult, reset } = store.getState()

  useEffect(() => {
    const actions = store.getState()
    const init = telegram()?.initData

    if (!init) {
      actions.setConnection(ConnectionStatus.Expired)

      return
    }

    const transport = new AppTransport(init, {
      onConnection: (connection) => {
        if (!runtime.isCurrent(lease)) return
        actions.setConnection(connection)
        if (connection === ConnectionStatus.Expired) actions.setError(ErrorCode.TELEGRAM_AUTH_FAILED)
      },
      onHistoryStatus: (sessionId, status) => {
        if (runtime.isCurrent(lease) && status !== HistoryStatus.Ready) actions.setHistoryStatus(sessionId, status)
      },
      onHistory: (sessionId, events) => {
        if (runtime.isCurrent(lease)) actions.receiveHistory(sessionId, events)
      },
      onFrame: (frame) => {
        if (runtime.isCurrent(lease)) actions.receiveFrame(frame)
      },
    })

    const lease = runtime.attach(transport)

    void transport.start().catch((error) => {
      if (runtime.isCurrent(lease)) actions.setError(error instanceof Error ? error.message : ErrorCode.TELEGRAM_AUTH_FAILED)
    })

    return () => {
      runtime.clear(lease)
      transport.close()
    }
  }, [store, runtime])

  async function logout() {
    const transport = runtime.clear()

    reset(ConnectionStatus.Expired)

    try {
      await transport?.logout()
    } catch {
      transport?.close()
    }
  }

  return { state, error, setError, result, setResult, logout, reset, attachments: runtime.client?.attachments }
}
