import { useQuery } from "@tanstack/react-query"
import { CodedError, ErrorCode, type HistoryMessage, type Session } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"
import { HISTORY_OUTLINE_QUERY, HISTORY_OUTLINE_STALE_MS } from "@/pages/session/config/message-navigation"

const NONE: HistoryMessage[] = []

/**
 * Every owner's message of the session's conversation, for the rail; empty until loaded or where the host has none.
 * `refresh` rereads it when the loaded window moves away from messages sent since it was read.
 */
export function useHistoryOutline(session: Session) {
  const runtime = useRuntime()

  const outline = useQuery({
    queryKey: [HISTORY_OUTLINE_QUERY, runtime.epoch, session.target.deviceId, session.id, session.generation],
    queryFn: async () => {
      const lease = runtime.current()

      if (!lease?.client.historyOutline) throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE)
      const messages = await lease.client.historyOutline(session.id)

      if (!runtime.isCurrent(lease)) throw new CodedError(ErrorCode.STALE_EPOCH)

      return messages
    },
    enabled: !!runtime.client?.historyOutline,
    retry: false,
    staleTime: HISTORY_OUTLINE_STALE_MS,
    refetchOnWindowFocus: false,
  })

  return { messages: outline.data ?? NONE, refresh: () => void outline.refetch() }
}
