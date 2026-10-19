import { useState, useSyncExternalStore } from "react"
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

const readHash = () => window.location.hash

/**
 * The subagent open over the selected session. With `routed` (the desktop host) it is the hash route
 * `#/sessions/:sessionId/agents/:agentId`, so a deep link or reload restores it and back returns to the parent route;
 * otherwise (the Telegram Mini App keeps its launch parameters in the hash) it is in-app state.
 * Selecting another session, or none, closes it either way.
 */
export function useSubagentView(selectedId: string | null, routed: boolean) {
  const runtime = useRuntime()
  const hash = useSyncExternalStore(subscribe, readHash, () => "")
  const [open, setOpen] = useState<OpenSubagent | null>(null)
  const [owner, setOwner] = useState(selectedId)

  if (owner !== selectedId) {
    setOwner(selectedId)
    setOpen(null)
  }

  const route = routed ? parseRoute(hash) : null
  const current = routed ? (route?.agentId && route.sessionId ? { sessionId: route.sessionId, agentId: route.agentId } : null) : open

  return {
    /** The host's client can read subagent transcripts (the session's own capability is checked where rows render). */
    supported: !!runtime.client?.subagentHistory,
    agentId: current && current.sessionId === selectedId ? current.agentId : null,
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
