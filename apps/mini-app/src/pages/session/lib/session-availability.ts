import { ConnectionStatus, DeviceStatus, IntegrationState, BindingState, SessionStatus, type Session } from "@protocol"
import type { SessionState } from "@/entities/session"

export function sessionAvailable(state: SessionState, session: Session) {
  return (
    state.connection === ConnectionStatus.Online &&
    state.snapshot?.deviceStatus === DeviceStatus.Online &&
    session.integrationState === IntegrationState.Ready &&
    session.binding === BindingState.Verified &&
    session.status !== SessionStatus.Ended
  )
}
