import type { HistoryMessage, HistoryNavigationDirection, Session } from "@protocol"
import type { SubagentHistoryStatus } from "@/pages/session/config/subagent"

export interface SubagentViewProps {
  session: Session
  agentId: string
  /** The parent session is observed live; otherwise the offline or observe-only label shows as on the session page. */
  available: boolean
  messages: HistoryMessage[]
  status: SubagentHistoryStatus
  /** Error code of a failed first read. */
  error: string
  onBack: () => void
  onHistoryPage?: ((direction: HistoryNavigationDirection) => void | Promise<void>) | undefined
}
