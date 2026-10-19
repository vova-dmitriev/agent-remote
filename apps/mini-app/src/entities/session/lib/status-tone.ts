import { SessionStatus, type Session } from "@protocol"
import { SessionStatusTone } from "../config/session-values"
import { sourceObserved } from "./availability"

/** One status mark for every session list; observe-only sources keep their live tone, their label says the rest. */
export function sessionStatusTone(session: Session): SessionStatusTone {
  if (!sourceObserved(session)) return SessionStatusTone.Unavailable
  if (session.status === SessionStatus.Running) return SessionStatusTone.Running

  if (session.status === SessionStatus.WaitingPermission || session.status === SessionStatus.WaitingInput) {
    return SessionStatusTone.Attention
  }

  return SessionStatusTone.Idle
}
