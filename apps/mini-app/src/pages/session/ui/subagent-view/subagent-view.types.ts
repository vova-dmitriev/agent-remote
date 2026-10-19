import type { HistoryMessage, HistoryNavigationDirection, Session } from "@protocol"
import type { SubagentHistoryStatus } from "@/pages/session/config/subagent"

export interface SubagentViewProps {
  session: Session
  agentId: string
  /** The parent session is observed live; otherwise the transcript shown is the last one read. */
  available: boolean
  messages: HistoryMessage[]
  status: SubagentHistoryStatus
  /** Error code of a failed first read. */
  error: string
  onBack: () => void
  onRetry?: (() => void) | undefined
  onHistoryPage?: ((direction: HistoryNavigationDirection) => void | Promise<void>) | undefined
}
