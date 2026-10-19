import { BindingState, ErrorCode, IntegrationState, SessionStatus, type Session } from "@protocol"
import type { MessageKey } from "@/shared/lib/i18n"
import { statuses } from "./labels"

export function sourceAvailable(session: Session) {
  return (
    session.integrationState === IntegrationState.Ready &&
    session.binding === BindingState.Verified &&
    session.status !== SessionStatus.Ended
  )
}

/** A live source the companion observes and reads history from, while remote input needs a restart. */
function sourceObservedOnly(session: Session) {
  return (
    session.integrationState === IntegrationState.NeedsRestart &&
    session.capabilities.observe &&
    session.capabilities.history &&
    session.status !== SessionStatus.Ended
  )
}

export function sourceObserved(session: Session) {
  return sourceAvailable(session) || sourceObservedOnly(session)
}

export function sessionStatusLabel(session: Session, online = true): MessageKey {
  if (session.status === SessionStatus.Ended) return statuses[SessionStatus.Ended]
  if (session.errorCode === ErrorCode.CODEX_FRAME_TOO_LARGE) return "sessionTooLarge"
  if (!online) return "sessionOffline"
  if (sourceObservedOnly(session)) return "observeOnlyNeedsRestart"
  if (!sourceAvailable(session)) return "sessionOffline"
  if (session.status === SessionStatus.Idle && !session.capabilities.prompt) return "observeOnly"

  return statuses[session.status]
}
