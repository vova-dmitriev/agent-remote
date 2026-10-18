import { useEffect } from "react"
import { ConnectionStatus, HistoryStatus } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"
import { connectHost, useHost } from "@/shared/lib/host"
import { useSessionStore, useSessionStoreApi } from "./context/use-session-store"

export function useSessionConnection() {
  const store = useSessionStoreApi()
  const runtime = useRuntime()
  const host = useHost()
  const state = useSessionStore((current) => current.session)
  const error = useSessionStore((current) => current.error)
  const result = useSessionStore((current) => current.result)
  const { setError, setResult, reset } = store.getState()

  useEffect(() => {
    const actions = store.getState()

    return connectHost(host, runtime, {
      onConnection: (connection) => {
        actions.setConnection(connection)
      },
      onHistoryStatus: (sessionId, status) => {
        if (status !== HistoryStatus.Ready) actions.setHistoryStatus(sessionId, status)
      },
      onHistory: (sessionId, events) => {
        actions.receiveHistory(sessionId, events)
      },
      onFrame: (frame) => {
        actions.receiveFrame(frame)
      },
    })
  }, [store, runtime, host])

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
