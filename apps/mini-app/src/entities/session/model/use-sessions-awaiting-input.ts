import { useMemo } from "react"
import { sessionsAwaitingInput } from "../lib/selectors"
import { useSessionStore } from "./context/use-session-store"

/** Sessions with a pending permission or question; recomputed only when sessions, permissions or questions change. */
export function useSessionsAwaitingInput() {
  const sessions = useSessionStore((state) => state.session.snapshot?.sessions)
  const permissions = useSessionStore((state) => state.session.snapshot?.permissions)
  const userInputs = useSessionStore((state) => state.session.snapshot?.userInputs)

  return useMemo(() => sessionsAwaitingInput(sessions, permissions, userInputs), [sessions, permissions, userInputs])
}
