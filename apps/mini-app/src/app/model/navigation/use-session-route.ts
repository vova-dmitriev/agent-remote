import { useEffect, useRef, useSyncExternalStore } from "react"
import type { Session } from "@protocol"
import { AppRoute, parseRoute, sessionRoute } from "@/shared/lib/routes"

interface SessionRouteOptions {
  selectedId: string | null
  sessions: Session[]
  /** The snapshot is current, so a missing session is really gone rather than not loaded yet. */
  ready: boolean
  open: (session: Session) => void
  close: () => void
}

interface RouteSelection {
  sessionId: string | null
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
 * Desktop selection follows the hash route: `#/` is the placeholder pane, `#/sessions/:id` the open session
 * (a subagent route keeps its parent selected). Load, reload and back/forward apply the route; selecting in the
 * app pushes a new entry, while an unknown or non-app hash is replaced.
 */
export function useSessionRoute({ selectedId, sessions, ready, open, close }: SessionRouteOptions) {
  const hash = useSyncExternalStore(subscribe, readHash, () => "")
  const applied = useRef<string | null>(null)
  const awaiting = useRef<RouteSelection | null>(null)

  useEffect(() => {
    if (!ready || applied.current === hash) return
    applied.current = hash
    awaiting.current = null

    const route = parseRoute(hash)
    const target = route?.sessionId ?? null

    if (!route || target === selectedId) return

    if (target === null) {
      awaiting.current = { sessionId: null }
      close()

      return
    }

    const session = sessions.find((item) => item.id === target)

    if (!session) return
    awaiting.current = { sessionId: session.id }
    open(session)
  }, [hash, ready, sessions, selectedId, open, close])

  useEffect(() => {
    if (applied.current !== hash) return
    if (awaiting.current && awaiting.current.sessionId !== selectedId) return
    awaiting.current = null

    const route = parseRoute(hash)

    if (route && (route.sessionId ?? null) === selectedId) return

    const known = !!route && (!route.sessionId || sessions.some((session) => session.id === route.sessionId))
    const next = selectedId ? sessionRoute(selectedId) : AppRoute.Root
    const url = window.location.pathname + window.location.search + next

    applied.current = next
    if (known) window.history.pushState(null, "", url)
    else window.history.replaceState(null, "", url)
  }, [hash, selectedId, sessions])
}
