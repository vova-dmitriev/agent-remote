import type { Session } from "@protocol"

export interface NativeInputHelpProps {
  session: Session
  onRestart?: () => void
  disabled?: boolean
}
