import { HistoryPageDirection, HistoryDirection, FrameType, HistoryStatus, type EventEnvelope, type HistoryMessage } from "@protocol"
import { reduceSessionState, type SessionState } from "../session-state"

export function reduceHistoryWindow(
  state: SessionState,
  sessionId: string,
  events: EventEnvelope[],
  direction: HistoryPageDirection = HistoryDirection.After,
  replace = false,
  baseline?: ReadonlyMap<string, HistoryMessage>,
): SessionState {
  const preserved = baseline ? (state.messages[sessionId] ?? []).filter((message) => baseline.get(message.id) !== message) : []
  const retainedIds = new Set(preserved.map((message) => message.id))
  const versions = Object.fromEntries(Object.entries(state.messageVersions[sessionId] ?? {}).filter(([id]) => retainedIds.has(id)))

  const base = replace
    ? {
        ...state,
        messages: { ...state.messages, [sessionId]: preserved },
        messageVersions: { ...state.messageVersions, [sessionId]: versions },
      }
    : state

  const session = events.reduce((current, event) => reduceSessionState(current, { type: FrameType.Event, event }, direction), base)

  return { ...session, history: { sessionId, status: HistoryStatus.Ready } }
}
