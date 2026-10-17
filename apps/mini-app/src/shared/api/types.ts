import { ConnectionStatus, HistoryNavigationDirection, HistoryStatus, type EventEnvelope, type ServerFrame } from "@protocol"

export type Connection = ConnectionStatus
export interface Device {
  id: string
  last_seen_at: string
}

export type { HistoryStatus } from "@protocol"
export type HistoryDirection = HistoryNavigationDirection

export interface TransportHandlers {
  onFrame: (frame: ServerFrame) => void
  onConnection: (connection: Connection) => void
  onHistory?: (sessionId: string, events: EventEnvelope[]) => void
  onHistoryStatus?: (sessionId: string, status: HistoryStatus) => void
}
