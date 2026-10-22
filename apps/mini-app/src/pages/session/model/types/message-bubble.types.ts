import { AgentName } from "@/entities/session"
import type { HistoryMessage } from "@protocol"

export interface MessageBubbleProps {
  message: HistoryMessage
  agent: AgentName
  sessionId?: string
}

export interface MessageTextProps {
  id: string
  text: string
}
