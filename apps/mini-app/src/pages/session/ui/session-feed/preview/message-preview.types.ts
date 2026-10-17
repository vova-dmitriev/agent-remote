import { AgentName } from "@/entities/session"
import type { HistoryMessage } from "@protocol"

export interface MessagePreviewProps {
  id: string
  message: HistoryMessage
  anchor: HTMLElement
  agent: AgentName
  keep: () => void
  leave: () => void
}
