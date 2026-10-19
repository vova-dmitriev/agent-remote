import { ConnectionStatus, DeviceStatus, type Session } from "@protocol"
import { sourceObserved, type SessionState } from "@/entities/session"

/** The app and device are online and the session source is observed live, with or without remote input. */
export function sessionObserved(state: SessionState, session: Session) {
  return state.connection === ConnectionStatus.Online && state.snapshot?.deviceStatus === DeviceStatus.Online && sourceObserved(session)
}
