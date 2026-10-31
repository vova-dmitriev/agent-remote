import type { Session } from "@protocol"

export interface SessionCardProps {
  session: Session
  onSelect: (session: Session) => void
  awaitingInput?: boolean
  /** The list already names the project above the card. */
  hideFolder?: boolean
}
