import { AgentName, SessionTab } from "@/entities/session"
import type { HistoryMessage, AppSnapshot, HistoryStatus, HistoryNavigationDirection } from "@protocol"

export interface SessionFeedProps {
  sessionId: string
  onHistoryPage?: ((direction: HistoryNavigationDirection) => void | Promise<void>) | undefined
  readingScope?: string | undefined
  messages: HistoryMessage[]
  historyStatus?: HistoryStatus
  available?: boolean
  tab: SessionTab
  terminal: AppSnapshot["terminal"]
  agent: AgentName
  /** When the session's newest message happened; newer history is unloaded while the feed ends earlier. */
  newestAt?: number | undefined
}
