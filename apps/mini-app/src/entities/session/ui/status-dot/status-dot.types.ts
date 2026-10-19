import type { Session } from "@protocol"

export interface SessionStatusDotProps {
  session: Session
  /** Size and placement; the tone colours come from the shared status map. */
  className?: string
}
