import { ConnectionStatus, DeviceStatus, type Session } from "@protocol"
import { sourceAvailable, type SessionState } from "@/entities/session"

export function sessionAvailable(state: SessionState, session: Session) {
  return state.connection === ConnectionStatus.Online && state.snapshot?.deviceStatus === DeviceStatus.Online && sourceAvailable(session)
}
