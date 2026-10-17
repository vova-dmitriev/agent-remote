import { AgentName, SessionTab } from "@/entities/session"
import type { HistoryMessage, AppSnapshot, HistoryStatus } from "@protocol"
import type { useFollowMessages } from "@/pages/session/model/use-follow-messages"

export interface FeedContentProps {
  sessionId: string
  messages: HistoryMessage[]
  tab: SessionTab
  terminal: AppSnapshot["terminal"]
  agent: AgentName
  historyStatus: HistoryStatus
  virtualizer: ReturnType<typeof useFollowMessages>["virtualizer"]
}
