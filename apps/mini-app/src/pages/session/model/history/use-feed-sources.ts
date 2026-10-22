import { useMemo, useState } from "react"
import type { HistoryMessage, Session } from "@protocol"
import { promptEchoes, useSessionStore } from "@/entities/session"
import { useRuntime } from "@/shared/lib/runtime"
import { useHistoryOutline } from "./use-history-outline"

type Around = ((id: string, cursor?: string) => Promise<boolean>) | undefined

/**
 * What the session feed shows beyond its loaded window: sent prompts not yet recorded, the conversation's outline for
 * the rail, and the chat search with the found message to go to. Going outside the window rereads the outline, which
 * may lack messages sent since it was read.
 */
export function useFeedSources(session: Session, messages: HistoryMessage[], around: Around) {
  const runtime = useRuntime()
  const outline = useHistoryOutline(session)
  const echoes = useSessionStore((store) => store.echoes)
  const outbox = useSessionStore((store) => store.outbox)
  const [searching, setSearching] = useState(false)
  const [focus, setFocus] = useState<{ id: string; cursor?: string | undefined; at: number } | null>(null)

  const feed = useMemo(() => {
    const pending = promptEchoes({ echoes, outbox }, session.id, messages)

    return pending.length ? [...messages, ...pending] : messages
  }, [echoes, outbox, session.id, messages])

  return {
    feed,
    outline: outline.messages,
    around:
      around &&
      ((id: string, cursor?: string) => {
        outline.refresh()

        return around(id, cursor)
      }),
    search: {
      open: searching,
      focus,
      /** Opens the search; absent where the host cannot search. */
      show: runtime.client?.historySearch ? () => setSearching(true) : undefined,
      close: () => setSearching(false),
      pick: (message: HistoryMessage) => setFocus({ id: message.id, cursor: message.historyCursor, at: Date.now() }),
    },
  }
}
