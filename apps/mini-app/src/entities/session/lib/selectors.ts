import { SessionStatus, type AppSnapshot, type Session } from "@protocol"
import { ProviderFilterValue } from "../config/session-values"
import { agentName } from "./labels"
import type { SessionState } from "../model/session-state"

export function selectedSession(state: SessionState) {
  return (
    state.snapshot?.sessions.find((session) => session.id === state.selectedId) ??
    (state.selectedListedSession?.id === state.selectedId ? state.selectedListedSession : undefined)
  )
}

type Permissions = AppSnapshot["permissions"] | undefined
type UserInputs = AppSnapshot["userInputs"]

const NO_RECENCY = 0

function pendingPermissions(permissions: Permissions, session: Session) {
  return session.capabilities.permission
    ? (permissions?.filter((permission) => permission.sessionId === session.id && permission.generation === session.generation) ?? [])
    : []
}

function pendingUserInputs(userInputs: UserInputs, session: Session) {
  return session.capabilities.userInput && session.status !== SessionStatus.Ended
    ? (userInputs?.filter((request) => request.sessionId === session.id && request.generation === session.generation) ?? [])
    : []
}

export function sessionPermissions(state: SessionState, session: Session) {
  return pendingPermissions(state.snapshot?.permissions, session)
}

export function sessionUserInputs(state: SessionState, session: Session) {
  return pendingUserInputs(state.snapshot?.userInputs, session)
}

export function filterByProvider(sessions: Session[], provider: ProviderFilterValue) {
  return provider === ProviderFilterValue.All ? sessions : sessions.filter((session) => agentName(session) === provider)
}

/**
 * The time every session list orders by: the last message, or for a session created from the app and still empty
 * its creation. Status events (`lastEventAt`) never reorder a list, so a found session without messages has no
 * recency and sorts last (pinned by tests/e2e/sessions/session-labels-order.spec.ts).
 */
export function sessionRecency(session: Session) {
  return session.lastMessageAt ?? session.createdAt ?? NO_RECENCY
}

/** Newest first; the one ordering shared by the session list and the desktop sidebar. */
export function sortByRecency(sessions: Session[]) {
  return [...sessions].sort((a, b) => sessionRecency(b) - sessionRecency(a))
}

/** Ids of sessions with a pending permission or question in the snapshot, for the attention tone. */
export function sessionsAwaitingInput(
  sessions: Session[] | undefined,
  permissions: Permissions,
  userInputs: UserInputs,
): ReadonlySet<string> {
  const ids = new Set<string>()

  for (const session of sessions ?? []) {
    if (pendingPermissions(permissions, session).length || pendingUserInputs(userInputs, session).length) ids.add(session.id)
  }

  return ids
}
