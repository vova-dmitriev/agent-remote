import { useCallback, useEffect, useMemo, useState } from "react"
import { ErrorCode, HistoryDirection, type HistoryMessage, type HistoryNavigationDirection } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"
import { SUBAGENT_POLL_INTERVAL_MS, SUBAGENT_UNAVAILABLE_CODES, SubagentHistoryStatus } from "@/pages/session/config/subagent"
import { foldToolResults, mergeSubagentPage, oldestCursor } from "@/pages/session/lib/subagent-history"
import { SubagentPoller } from "./subagent-poller"

interface SubagentHistoryState {
  key: string
  status: SubagentHistoryStatus
  messages: HistoryMessage[]
  error: string
}

export interface SubagentHistoryOptions {
  sessionId: string
  generation: string
  agentId: string
  /** The transcript can still grow and the session is observed: poll while the view is open and visible. */
  live: boolean
}

const initial = (key: string): SubagentHistoryState => ({ key, status: SubagentHistoryStatus.Loading, messages: [], error: "" })

/**
 * The read-only transcript window of one subagent view, keyed by session, subagent and generation: its items
 * never enter the parent feed, a new key starts empty, and polling stops on unmount or while the page is hidden.
 */
export function useSubagentHistory({ sessionId, generation, agentId, live }: SubagentHistoryOptions) {
  const runtime = useRuntime()
  const key = [sessionId, agentId, generation].join("\u0000")
  const [stored, setState] = useState(() => initial(key))
  const state = stored.key === key ? stored : initial(key)

  const read = useCallback(
    async (direction: HistoryNavigationDirection, edge?: string) => {
      const lease = runtime.current()
      const client = lease?.client

      const apply = (update: (previous: SubagentHistoryState) => SubagentHistoryState) =>
        setState((previous) => update(previous.key === key ? previous : initial(key)))

      if (!client?.subagentHistory) {
        apply((previous) => ({ ...previous, status: SubagentHistoryStatus.Unavailable, error: ErrorCode.CAPABILITY_UNAVAILABLE }))

        return
      }

      try {
        const events = await client.subagentHistory(sessionId, agentId, direction, edge)

        if (!events || !runtime.isCurrent(lease)) return
        const page = direction === HistoryDirection.Before ? HistoryDirection.Before : HistoryDirection.After

        apply((previous) => ({
          ...previous,
          status: SubagentHistoryStatus.Ready,
          error: "",
          messages: mergeSubagentPage(previous.messages, events, page),
        }))
      } catch (error) {
        if (!runtime.isCurrent(lease)) return
        const code = error instanceof Error ? error.message : ErrorCode.REQUEST_FAILED

        const status = SUBAGENT_UNAVAILABLE_CODES.includes(code) ? SubagentHistoryStatus.Unavailable : SubagentHistoryStatus.Failed

        // Items already shown stay; a failed re-read only matters before the first page arrives.
        apply((previous) => (previous.messages.length ? previous : { ...previous, status, error: code }))
      }
    },
    [runtime, sessionId, agentId, key],
  )

  useEffect(() => {
    const poller = new SubagentPoller({
      refresh: () => read(HistoryDirection.Latest),
      interval: SUBAGENT_POLL_INTERVAL_MS,
      live,
      visibility: document,
    })

    poller.start()

    return () => poller.stop()
  }, [read, live])

  const page = useCallback(
    async (direction: HistoryNavigationDirection) => {
      if (direction === HistoryDirection.Before) await read(HistoryDirection.Before, oldestCursor(state.messages))
      else if (direction === HistoryDirection.Latest) await read(HistoryDirection.Latest)
    },
    [read, state.messages],
  )

  const messages = useMemo(() => foldToolResults(state.messages), [state.messages])

  return { status: state.status, error: state.error, messages, page }
}
