import type { Session } from "@protocol"
import type { RemoveSessionController } from "../model/use-remove-session"

export interface RemoveSessionItemsProps {
  session: Session
  controller: RemoveSessionController
  disabled: boolean
  /** Called once the device took the removal; the session leaves its next snapshot. */
  onRemoved: () => void
}
