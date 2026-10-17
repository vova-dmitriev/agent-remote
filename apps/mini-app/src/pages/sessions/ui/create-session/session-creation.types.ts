import { AgentProvider, type Session } from "@protocol"

export interface SessionCreationProps {
  sessions: Session[]
  disabled: boolean
  create: (session: Session, provider: AgentProvider) => void
}
