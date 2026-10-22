import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CodedError, ErrorCode, HISTORY_SEARCH_QUERY_CHARS, type Session } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"
import { CHAT_SEARCH_DEBOUNCE_MS, CHAT_SEARCH_QUERY } from "@/pages/session/config/message-navigation"

/** Words typed into the chat search and the conversation's messages that hold them, searched once typing rests. */
export function useChatSearch(session: Session) {
  const runtime = useRuntime()
  const [text, setText] = useState("")
  const [query, setQuery] = useState("")

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim().slice(0, HISTORY_SEARCH_QUERY_CHARS)), CHAT_SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [text])

  const results = useQuery({
    queryKey: [CHAT_SEARCH_QUERY, runtime.epoch, session.target.deviceId, session.id, session.generation, query],
    queryFn: async () => {
      const lease = runtime.current()

      if (!lease?.client.historySearch) throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE)
      const messages = await lease.client.historySearch(session.id, query)

      if (!runtime.isCurrent(lease)) throw new CodedError(ErrorCode.STALE_EPOCH)

      // Newest first, as the owner most often looks for something recent.
      return [...messages].reverse()
    },
    enabled: query.length > 0 && !!runtime.client?.historySearch,
    retry: false,
    refetchOnWindowFocus: false,
  })

  return {
    text,
    setText,
    query,
    matches: results.data,
    loading: results.isFetching,
    failed: results.isError,
    supported: !!runtime.client?.historySearch,
  }
}
