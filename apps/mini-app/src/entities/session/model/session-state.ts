import {
  ConnectionStatus,
  HistoryPageDirection,
  HistoryDirection,
  FrameType,
  EventType,
  DeviceStatus,
  BindingState,
  IntegrationState,
  SessionStatus,
  CapabilityKey,
  historySchema,
  type AppSnapshot,
  type ConnectorDescriptor,
  type HistoryMessage,
  type ServerFrame,
  type Session,
} from "@protocol"
import type { Connection, HistoryStatus } from "@/shared/api"
import { SessionActionType } from "../config/session-values"
import { sourceAvailable } from "../lib/availability"

export interface SessionState {
  snapshot: AppSnapshot | null
  connection: Connection
  selectedId: string | null
  history: { sessionId: string; status: HistoryStatus } | null
  deviceId: string | null
  connectors: ConnectorDescriptor[]
  messages: Record<string, HistoryMessage[]>
  messageVersions: Record<string, Record<string, { streamId: string; seq: number; at?: number }>>
}
export const initialState = (): SessionState => ({
  snapshot: null,
  connection: ConnectionStatus.Connecting,
  selectedId: null,
  history: null,
  deviceId: null,
  connectors: [],
  messages: {},
  messageVersions: {},
})

export function reduceSessionState(
  state: SessionState,
  message: ServerFrame | { type: typeof SessionActionType.Logout },
  direction: HistoryPageDirection = HistoryDirection.After,
): SessionState {
  if (message.type === SessionActionType.Logout) return initialState()

  if (message.type === FrameType.Snapshot) {
    const changed = state.deviceId !== message.deviceId || state.snapshot?.cursor.streamId !== message.snapshot.cursor.streamId

    return {
      ...state,
      snapshot: message.snapshot,
      deviceId: message.deviceId,
      connectors: message.connectors,
      messages: changed ? {} : state.messages,
      history: changed ? null : state.history,
      messageVersions: changed ? {} : state.messageVersions,
      selectedId: message.snapshot.sessions.some((s) => s.id === state.selectedId) ? state.selectedId : null,
    }
  }

  if (message.type === FrameType.ResyncRequired)
    return { ...state, snapshot: null, messages: {}, messageVersions: {}, selectedId: null, history: null }
  if (message.type === FrameType.DeviceStatus && state.deviceId === message.deviceId && state.snapshot)
    return {
      ...state,
      snapshot: {
        ...state.snapshot,
        deviceStatus: message.status,
        permissions: message.status === DeviceStatus.Offline ? [] : state.snapshot.permissions,
        userInputs: message.status === DeviceStatus.Offline ? [] : state.snapshot.userInputs,
        terminal: message.status === DeviceStatus.Offline ? null : state.snapshot.terminal,
      },
    }

  if (
    message.type === FrameType.Event &&
    message.event.deviceId === state.deviceId &&
    message.event.sessionId &&
    message.event.type === EventType.Message
  ) {
    const parsed = historySchema.safeParse(message.event.payload)

    if (!parsed.success) return state
    const id = message.event.sessionId
    const previous = state.messages[id] ?? []
    const version = state.messageVersions[id]?.[parsed.data.id]

    if (
      version &&
      (version.streamId === message.event.streamId ? version.seq >= message.event.seq : (version.at ?? 0) > message.event.occurredAt)
    )
      return state
    const index = previous.findIndex((m) => m.id === parsed.data.id)
    const messages = [...previous]

    if (index === -1) messages.push(parsed.data)
    else
      messages[index] = {
        ...parsed.data,
        ...(parsed.data.historyCursor || !previous[index]?.historyCursor ? {} : { historyCursor: previous[index]!.historyCursor }),
      }
    messages.sort((a, b) => a.occurredAt - b.occurredAt)
    const kept = direction === HistoryDirection.Before ? messages.slice(0, 500) : messages.slice(-500)

    const versions = {
      ...state.messageVersions[id],
      [parsed.data.id]: { streamId: message.event.streamId, seq: message.event.seq, at: message.event.occurredAt },
    }

    const retainedIds = new Set(kept.map((message) => message.id))

    for (const key of Object.keys(versions)) if (!retainedIds.has(key)) delete versions[key]

    return {
      ...state,
      snapshot: state.snapshot
        ? {
            ...state.snapshot,
            sessions: state.snapshot.sessions.map((session) =>
              session.id === id ? { ...session, lastMessageAt: Math.max(session.lastMessageAt ?? 0, parsed.data.occurredAt) } : session,
            ),
          }
        : null,
      messages: { ...state.messages, [id]: kept },
      messageVersions: { ...state.messageVersions, [id]: versions },
    }
  }

  return state
}

export function canQueuePrompt(connection: Connection, deviceStatus: DeviceStatus, session: Session) {
  return (
    connection === ConnectionStatus.Online &&
    deviceStatus === DeviceStatus.Online &&
    sourceAvailable(session) &&
    !!session.capabilities.prompt
  )
}

export function canSend(connection: Connection, deviceStatus: DeviceStatus, session: Session, action: CapabilityKey) {
  return (
    connection === ConnectionStatus.Online &&
    deviceStatus === DeviceStatus.Online &&
    session.binding === BindingState.Verified &&
    session.integrationState === IntegrationState.Ready &&
    !!session.capabilities[action] &&
    (action !== CapabilityKey.UserInput || session.status !== SessionStatus.Ended) &&
    (action !== CapabilityKey.Prompt || session.status === SessionStatus.Idle)
  )
}
