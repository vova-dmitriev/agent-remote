import type { Session } from "@protocol"

export interface SessionStatusDotProps {
  session: Session
  /** A pending permission or question for this session (see `useSessionsAwaitingInput`). */
  awaitingInput?: boolean
  /** Size and placement; the tone colours come from the shared status map. */
  className?: string
}
