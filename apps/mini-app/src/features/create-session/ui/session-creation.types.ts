import { AgentProvider, type ModelChoice, type ProviderModels, type Session } from "@protocol"
import type { ProfileExecution } from "../model/profile-launch"
import type { ProfileList } from "@protocol"

export interface SessionCreationProps {
  sessions: Session[]
  disabled: boolean
  online: boolean
  create: (session: Session, provider: AgentProvider, execution?: ProfileExecution, model?: ModelChoice, resume?: string) => void
  /** The models the device's own sign-in of each agent offers. */
  models?: ProviderModels[]
  /** The device's projects a session can start in without one there yet (a shared VM's projects root). */
  projects?: readonly string[]
  /** Starts a session in one of those projects through the device. */
  createInProject?: (cwd: string, provider: AgentProvider, model?: ModelChoice, resume?: string) => Promise<unknown>
  profileData?: ProfileList
  /** Renders the form without its toggle, e.g. in the desktop "New session" pane. */
  inline?: boolean
}
