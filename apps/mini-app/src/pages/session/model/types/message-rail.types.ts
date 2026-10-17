import { AgentName } from "@/entities/session"
import type { HistoryMessage } from "@protocol"

export interface MessageRailProps {
  messages: HistoryMessage[]
  activeId: string | null
  jump: (id: string) => void
  agent: AgentName
}
