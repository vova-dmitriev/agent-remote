import { useMemo } from "react"
import { sessionsAwaitingInput } from "../lib/selectors"
import { useSessionStore } from "./context/use-session-store"

/** Sessions with a pending permission or question; recomputed only when the snapshot changes. */
export function useSessionsAwaitingInput() {
  const snapshot = useSessionStore((state) => state.session.snapshot)

  return useMemo(() => sessionsAwaitingInput(snapshot), [snapshot])
}
