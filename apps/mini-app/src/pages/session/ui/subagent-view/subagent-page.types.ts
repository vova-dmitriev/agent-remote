import type { Session } from "@protocol"
import type { SessionState } from "@/entities/session"

export interface SubagentPageProps {
  session: Session
  state: SessionState
  agentId: string
  /** Returns to the parent session page. */
  onBack: () => void
}
