import { useRef, useState } from "react"
import { HistoryStatus, HistoryDirection, ErrorCode, type Session, type HistoryNavigationDirection } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"
import { SessionTab } from "../config/session-values"
import { useSessionStoreApi } from "./context/use-session-store"
import { reduceHistoryWindow } from "./store/history"

export function useSessionSelection() {
  const runtime = useRuntime()
  const store = useSessionStoreApi()
  const { setState, setError } = store.getState()
  const [tab, setTab] = useState<SessionTab>(SessionTab.History)
  const selection = useRef(0)
  const selected = useRef<string | null>(null)
  const historyError = useRef<string | null>(null)

  async function select(session: Session) {
    selected.current = session.id
    const request = ++selection.current
    const lease = runtime.current()
    const previousHistoryError = historyError.current

    historyError.current = null
    setError((previous) => (previous === ErrorCode.HISTORY_RELOAD_FAILED || previous === previousHistoryError ? "" : previous))

    setState((s) => ({
      ...s,
      selectedId: session.id,
      history: { sessionId: session.id, status: HistoryStatus.Loading },
      messages: { ...s.messages, [session.id]: [] },
      messageVersions: { ...s.messageVersions, [session.id]: {} },
    }))

    setTab(SessionTab.History)
    lease?.client.selectTarget(session.target.deviceId, session.id)

    try {
      const transport = lease?.client

      if (!transport) throw new Error(ErrorCode.SESSION_UNAVAILABLE)
      const events = await transport.history(session.id)

      if (!events || !runtime.isCurrent(lease) || selection.current !== request) return
      setState((s) => reduceHistoryWindow(s, session.id, events))
    } catch (error) {
      if (runtime.isCurrent(lease) && selection.current === request) {
        setState((s) => ({ ...s, history: { sessionId: session.id, status: HistoryStatus.Error } }))
        const code = error instanceof Error ? error.message : ErrorCode.SESSION_UNAVAILABLE

        historyError.current = code
        setError(code)
      }
    }
  }

  async function loadPage(direction: HistoryNavigationDirection) {
    const lease = runtime.current()

    const transport = lease?.client,
      request = direction === HistoryDirection.Latest ? ++selection.current : selection.current

    const sessionId = selected.current

    if (!transport || !sessionId) return

    const messages = store.getState().session.messages[sessionId] ?? []
    const baseline = direction === HistoryDirection.Latest ? new Map(messages.map((message) => [message.id, message])) : undefined

    try {
      const edge =
        messages.length >= 500 ? (direction === HistoryDirection.Before ? messages[0] : messages.at(-1))?.historyCursor : undefined

      const events = await (direction === HistoryDirection.Latest
        ? transport.history(sessionId, true)
        : transport.historyPage(sessionId, direction, edge))

      if (!events || !runtime.isCurrent(lease) || selection.current !== request) return

      setState((s) =>
        reduceHistoryWindow(
          s,
          sessionId,
          events,
          direction === HistoryDirection.Before ? HistoryDirection.Before : HistoryDirection.After,
          direction === HistoryDirection.Latest,
          baseline,
        ),
      )
    } catch (error) {
      if (runtime.isCurrent(lease) && selection.current === request)
        setError(error instanceof Error ? error.message : ErrorCode.HISTORY_RELOAD_FAILED)
    }
  }

  function back(deviceId: string | null) {
    ++selection.current
    selected.current = null
    setState((s) => ({ ...s, selectedId: null, history: null }))
    if (deviceId) runtime.client?.selectTarget(deviceId, null)
  }

  return { tab, setTab, select, back, loadPage }
}
