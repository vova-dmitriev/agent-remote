import type { HistoryMessage, Session } from "@protocol"
import type { AgentName } from "@/entities/session"

export interface ChatSearchProps {
  open: boolean
  session: Session
  agent: AgentName
  /** Goes to a found message, loaded or not. */
  onPick: (message: HistoryMessage) => void
  onClose: () => void
}

export interface ChatSearchResultProps {
  message: HistoryMessage
  query: string
  agent: AgentName
  onPick: (message: HistoryMessage) => void
}

export interface ChatSearchButtonProps {
  onOpen?: (() => void) | undefined
}
