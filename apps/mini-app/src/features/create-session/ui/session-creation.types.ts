import { AgentProvider, type Session } from "@protocol"
import type { ProfileExecution } from "../model/profile-launch"
import type { ProfileList } from "@protocol"

export interface SessionCreationProps {
  sessions: Session[]
  disabled: boolean
  online: boolean
  create: (session: Session, provider: AgentProvider, execution?: ProfileExecution) => void
  profileData?: ProfileList
  /** Renders the form without its toggle, e.g. in the desktop "New session" pane. */
  inline?: boolean
}
