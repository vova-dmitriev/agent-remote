import type { AgentModel, Session } from "@protocol"
import type { SwitchModelController } from "../model/use-switch-model"

export interface ModelDialogProps {
  open: boolean
  onClose: () => void
  session: Session
  /** The models the device's own sign-in of the session's agent offers. */
  models: AgentModel[]
  controller: SwitchModelController
  disabled: boolean
}

export interface ModelMenuItemProps {
  session: Session
  models: AgentModel[]
  controller: SwitchModelController
  onOpen: () => void
}

export interface ChoiceListProps {
  label: string
  values: readonly string[]
  current: string
  /** Values shown but not offered (a model the device does not list). */
  unavailable?: readonly string[]
  disabled: boolean
  testId: string
  optionTestId: string
  onPick: (value: string) => void
}
