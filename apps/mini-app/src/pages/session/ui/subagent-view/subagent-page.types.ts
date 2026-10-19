import type { Session } from "@protocol"
import type { SessionState } from "@/entities/session"

/** Mount with a key of session, subagent and generation: each gets its own transcript window. */
export interface SubagentPageProps {
  session: Session
  state: SessionState
  agentId: string
  /** Returns to the parent session page. */
  onBack: () => void
}
