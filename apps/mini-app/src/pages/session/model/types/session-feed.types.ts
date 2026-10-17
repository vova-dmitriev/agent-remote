import { AgentName, SessionTab } from "@/entities/session"
import type { HistoryMessage, AppSnapshot, HistoryStatus, HistoryNavigationDirection } from "@protocol"

export interface SessionFeedProps {
  sessionId: string
  onHistoryPage?: ((direction: HistoryNavigationDirection) => void | Promise<void>) | undefined
  readingScope?: string | undefined
  messages: HistoryMessage[]
  historyStatus?: HistoryStatus
  tab: SessionTab
  terminal: AppSnapshot["terminal"]
  agent: AgentName
}
