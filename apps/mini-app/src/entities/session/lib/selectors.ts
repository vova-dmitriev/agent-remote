import { SessionStatus, type AppSnapshot, type Session } from "@protocol"
import { ProviderFilterValue } from "../config/session-values"
import { agentName } from "./labels"
import type { SessionState } from "../model/session-state"

export function selectedSession(state: SessionState) {
  return state.snapshot?.sessions.find((session) => session.id === state.selectedId)
}

type Snapshot = AppSnapshot | null | undefined

const NO_RECENCY = 0

function snapshotPermissions(snapshot: Snapshot, session: Session) {
  return session.capabilities.permission
    ? (snapshot?.permissions.filter((permission) => permission.sessionId === session.id && permission.generation === session.generation) ??
        [])
    : []
}

function snapshotUserInputs(snapshot: Snapshot, session: Session) {
  return session.capabilities.userInput && session.status !== SessionStatus.Ended
    ? (snapshot?.userInputs?.filter((request) => request.sessionId === session.id && request.generation === session.generation) ?? [])
    : []
}

export function sessionPermissions(state: SessionState, session: Session) {
  return snapshotPermissions(state.snapshot, session)
}

export function sessionUserInputs(state: SessionState, session: Session) {
  return snapshotUserInputs(state.snapshot, session)
}

export function filterByProvider(sessions: Session[], provider: ProviderFilterValue) {
  return provider === ProviderFilterValue.All ? sessions : sessions.filter((session) => agentName(session) === provider)
}

/**
 * The time every session list orders by: the last message. Status events (`lastEventAt`) never reorder a list, so a
 * session without messages has no recency and sorts last (pinned by tests/e2e/session-labels-order.spec.ts).
 */
export function sessionRecency(session: Session) {
  return session.lastMessageAt ?? NO_RECENCY
}

/** Newest first; the one ordering shared by the session list and the desktop sidebar. */
export function sortByRecency(sessions: Session[]) {
  return [...sessions].sort((a, b) => sessionRecency(b) - sessionRecency(a))
}

/** Ids of sessions with a pending permission or question in the snapshot, for the attention tone. */
export function sessionsAwaitingInput(snapshot: Snapshot): ReadonlySet<string> {
  const ids = new Set<string>()

  for (const session of snapshot?.sessions ?? []) {
    if (snapshotPermissions(snapshot, session).length || snapshotUserInputs(snapshot, session).length) ids.add(session.id)
  }

  return ids
}
