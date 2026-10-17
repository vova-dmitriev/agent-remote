import { SessionStatus, type Session } from "@protocol"
import type { SessionState } from "../model/session-state"

export function selectedSession(state: SessionState) {
  return state.snapshot?.sessions.find((session) => session.id === state.selectedId)
}

export function sessionPermissions(state: SessionState, session: Session) {
  return session.capabilities.permission
    ? (state.snapshot?.permissions.filter(
        (permission) => permission.sessionId === session.id && permission.generation === session.generation,
      ) ?? [])
    : []
}

export function sessionUserInputs(state: SessionState, session: Session) {
  return session.capabilities.userInput && session.status !== SessionStatus.Ended
    ? (state.snapshot?.userInputs?.filter((request) => request.sessionId === session.id && request.generation === session.generation) ?? [])
    : []
}
