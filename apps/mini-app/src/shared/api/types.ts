import { ConnectionStatus, HistoryNavigationDirection, HistoryStatus, type EventEnvelope, type ServerFrame } from "@protocol"

export type Connection = ConnectionStatus
export interface Device {
  id: string
  last_seen_at: string
}

export type { HistoryStatus } from "@protocol"
export type HistoryDirection = HistoryNavigationDirection

/**
 * Why a transport made no history page request. Exhausted: it holds no cursor for that edge (the end was
 * reached) or already found the edge exhausted. Busy: a request for that edge is in flight. Stale: the
 * selection, socket or session generation changed, before or during the request.
 */
export const HistoryPageSkip = { Exhausted: "exhausted", Busy: "busy", Stale: "stale" } as const

export type HistoryPageSkip = (typeof HistoryPageSkip)[keyof typeof HistoryPageSkip]

export interface TransportHandlers {
  onFrame: (frame: ServerFrame) => void
  onConnection: (connection: Connection) => void
  onHistory?: (sessionId: string, events: EventEnvelope[]) => void
  onHistoryStatus?: (sessionId: string, status: HistoryStatus) => void
}
