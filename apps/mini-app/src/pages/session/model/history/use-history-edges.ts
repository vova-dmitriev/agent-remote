import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { HistoryDirection, type HistoryMessage, type HistoryNavigationDirection } from "@protocol"
import { settleHistoryEdge, type ExhaustedEdges } from "@/pages/session/lib/history/history-edges"
import type { HistoryPageLoader } from "@/pages/session/model/types/session-feed.types"

function edgeId(messages: HistoryMessage[], direction: HistoryNavigationDirection) {
  if (direction === HistoryDirection.Before) return messages[0]?.id
  if (direction === HistoryDirection.After) return messages.at(-1)?.id

  return undefined
}

/**
 * Whether unloaded history may exist past either end of the loaded window. The wire carries no total, so
 * an edge counts as exhausted only after a page request for it completed (loaded or declined by the transport)
 * without extending that edge; failed or stale requests keep it open.
 * Newer history additionally requires the session's last message time to be past the loaded tail.
 * `newest` holds only when the window is known to end at the session's newest message.
 */
export function useHistoryEdges(messages: HistoryMessage[], onHistoryPage: HistoryPageLoader | undefined, newestAt: number | undefined) {
  const current = useRef(messages)
  const [exhausted, setExhausted] = useState<ExhaustedEdges>({ before: null, after: null })

  useLayoutEffect(() => {
    current.current = messages
  }, [messages])

  const page = useCallback(
    async (direction: HistoryNavigationDirection) => {
      const edge = edgeId(current.current, direction)

      const outcome = await onHistoryPage?.(direction)

      setExhausted((previous) => settleHistoryEdge(previous, direction, edge, outcome))
    },
    [onHistoryPage],
  )

  const head = messages[0]
  const tail = messages.at(-1)
  const older = Boolean(onHistoryPage && head && exhausted.before !== head.id)
  const newer = Boolean(onHistoryPage && tail && newestAt !== undefined && newestAt > tail.occurredAt && exhausted.after !== tail.id)
  // Known to end at the newest message: the session's last message time is not past the tail, or the edge is exhausted.
  const newest = !tail || exhausted.after === tail.id || (newestAt !== undefined && newestAt <= tail.occurredAt)

  return { page, older, newer, newest }
}
