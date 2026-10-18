import { BindingState, IntegrationState, SessionStatus, type Session } from "@protocol"
import type { MessageKey } from "@/shared/lib/i18n"
import { statuses } from "./labels"

export function sourceAvailable(session: Session) {
  return (
    session.integrationState === IntegrationState.Ready &&
    session.binding === BindingState.Verified &&
    session.status !== SessionStatus.Ended
  )
}

export function sessionStatusLabel(session: Session, online = true): MessageKey {
  if (session.status === SessionStatus.Ended) return statuses[SessionStatus.Ended]
  if (!online || !sourceAvailable(session)) return "sessionOffline"
  if (session.status === SessionStatus.Idle && !session.capabilities.prompt) return "observeOnly"

  return statuses[session.status]
}
