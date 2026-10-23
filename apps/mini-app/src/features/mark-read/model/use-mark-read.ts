import { useEffect, useRef, useSyncExternalStore } from "react"
import type { HistoryMessage, Session } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"

/** How long the open session waits for its feed to settle before it sends a read mark. */
const MARK_DELAY_MS = 800

const subscribe = (notify: () => void) => {
  document.addEventListener("visibilitychange", notify)

  return () => document.removeEventListener("visibilitychange", notify)
}

const visible = () => document.visibilityState === "visible"

/**
 * Marks the open session read while the owner looks at it: when its device counts unread replies, up to the newest
 * message the feed has. The device clears the count, and every list shows it in its next snapshot.
 */
export function useMarkRead(session: Session | undefined, messages: readonly HistoryMessage[] | undefined) {
  const runtime = useRuntime()
  const shown = useSyncExternalStore(subscribe, visible, () => true)
  const sent = useRef(new Map<string, number>())
  const at = messages?.reduce((latest, message) => Math.max(latest, message.occurredAt), 0) ?? 0
  const id = session?.id
  const generation = session?.generation
  const unread = session?.unread ?? 0

  useEffect(() => {
    if (!id || !generation || !unread || !shown || at <= (sent.current.get(id) ?? 0)) return

    const timer = setTimeout(() => {
      const client = runtime.current()?.client

      if (!client) return
      sent.current.set(id, at)
      // A mark that did not arrive is sent again with the next message or the next visit.
      client.markSessionRead(id, generation, at).catch(() => sent.current.delete(id))
    }, MARK_DELAY_MS)

    return () => clearTimeout(timer)
  }, [runtime, id, generation, unread, shown, at])
}
