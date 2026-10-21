import type { AgentModel, Session } from "@protocol"
import type { SwitchModelController } from "../model/use-switch-model"

export interface ModelChipsProps {
  session: Session
  /** The models the device's own sign-in of the session's agent offers. */
  models: AgentModel[]
  controller: SwitchModelController
  disabled: boolean
}
