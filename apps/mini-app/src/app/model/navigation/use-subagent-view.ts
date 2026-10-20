import { useEffect, useState, useSyncExternalStore } from "react"
import { subagentIdSchema, type Session } from "@protocol"
import { useRuntime } from "@/shared/lib/runtime"
import { parseRoute, sessionRoute, subagentRoute } from "@/shared/lib/routes"

interface OpenSubagent {
  sessionId: string
  agentId: string
}

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange)
  window.addEventListener("popstate", onChange)

  return () => {
    window.removeEventListener("hashchange", onChange)
    window.removeEventListener("popstate", onChange)
  }
}

const unsubscribed = () => () => {}

const readHash = () => window.location.hash
const noHash = () => ""

/**
 * The subagent open over the selected session. With `routed` (the desktop host) it is the hash route
 * `#/sessions/:sessionId/agents/:agentId`, so a deep link or reload restores it and back returns to the parent route;
 * otherwise (the Telegram Mini App keeps its launch parameters in the hash, which is never read) it is in-app state.
 * Selecting another session, or none, closes it either way. A route that cannot be shown is replaced by the parent's.
 */
export function useSubagentView(selected: Session | null | undefined, routed: boolean) {
  const selectedId = selected?.id ?? null
  const runtime = useRuntime()
  const hash = useSyncExternalStore(routed ? subscribe : unsubscribed, routed ? readHash : noHash, noHash)
  const [open, setOpen] = useState<OpenSubagent | null>(null)
  const [owner, setOwner] = useState(selectedId)

  if (owner !== selectedId) {
    setOwner(selectedId)
    setOpen(null)
  }

  // Subagent transcripts need both the client and the session's source.
  const readable = !!runtime.client?.subagentHistory && !!selected?.capabilities.subagentHistory
  const route = routed ? parseRoute(hash) : null
  const target = routed ? (route?.agentId && route.sessionId ? { sessionId: route.sessionId, agentId: route.agentId } : null) : open
  const requested = target && target.sessionId === selectedId ? target.agentId : null
  // Only a well-formed id may read; one not listed yet is allowed, since opening the view makes the daemon rescan and it enforces the list.
  const agentId = requested !== null && readable && subagentIdSchema.safeParse(requested).success ? requested : null

  useEffect(() => {
    if (!routed || requested === null || agentId !== null || !selectedId) return
    window.history.replaceState(null, "", window.location.pathname + window.location.search + sessionRoute(selectedId))
  }, [routed, requested, agentId, selectedId])

  return {
    readable,
    agentId,
    open: (sessionId: string, agentId: string) => {
      if (routed) window.location.hash = subagentRoute(sessionId, agentId)
      else setOpen({ sessionId, agentId })
    },
    /** The view's own back control: returns to the parent session. */
    close: () => {
      if (routed && selectedId) window.location.hash = sessionRoute(selectedId)
      else setOpen(null)
    },
    /** Leaving the session altogether; the desktop session route sync rewrites the hash itself. */
    clear: () => setOpen(null),
  }
}
