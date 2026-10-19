import type { HistoryMessage, Session } from "@protocol"
import type { SubagentHistoryStatus } from "@/pages/session/config/subagent"
import type { HistoryPageLoader } from "@/pages/session/model/types/session-feed.types"

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
  onHistoryPage?: HistoryPageLoader | undefined
}
