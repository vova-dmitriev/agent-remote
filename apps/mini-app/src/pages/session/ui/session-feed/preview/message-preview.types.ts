import { AgentName } from "@/entities/session"
import type { HistoryMessage } from "@protocol"

export interface MessagePreviewProps {
  id: string
  message: HistoryMessage
  anchor: HTMLElement
  agent: AgentName
  keep: () => void
  leave: () => void
  /** Goes to the message, for a preview a tap opened: a second tap on it goes there. */
  open?: (() => void) | undefined
}

export interface PreviewBodyProps {
  message: HistoryMessage
  agent: AgentName
}
