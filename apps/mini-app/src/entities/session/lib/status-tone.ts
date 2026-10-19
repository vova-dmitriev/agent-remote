import { SessionStatus, type Session } from "@protocol"
import { SessionStatusTone } from "../config/session-values"
import { sourceObserved } from "./availability"

/**
 * One status mark for every session list; observe-only sources keep their live tone, their label says the rest.
 * `awaitingInput` is a pending permission or question for this session in the snapshot: it needs the user even when
 * the status has not caught up (e.g. a subagent's permission leaves the parent idle).
 */
export function sessionStatusTone(session: Session, awaitingInput = false): SessionStatusTone {
  if (!sourceObserved(session) || session.status === SessionStatus.Unknown) return SessionStatusTone.Unavailable

  if (awaitingInput || session.status === SessionStatus.WaitingPermission || session.status === SessionStatus.WaitingInput) {
    return SessionStatusTone.Attention
  }

  if (session.status === SessionStatus.Running) return SessionStatusTone.Running

  return SessionStatusTone.Idle
}
