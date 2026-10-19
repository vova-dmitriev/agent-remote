import type {
  AccountPreferences,
  AttachmentDescriptor,
  ClientCommand,
  CommandResult,
  EventEnvelope,
  HistoryPageDirection,
  PreferencePatch,
  ReadingPosition,
  ReadingPositionResponse,
  ExecutionProfileAccess,
  ContinuityAccess,
  ProfileRoutingAccess,
} from "@protocol"
import type { AttachmentAccess } from "./attachment-access"
import type { Device, HistoryPageSkip } from "./types"

export interface ApplicationOperations {
  getPreferences(): Promise<AccountPreferences>
  savePreferences(patch: PreferencePatch): Promise<AccountPreferences>
  renameSession(sessionId: string, title: string, generation: string): Promise<unknown>
  claimDevice(code: string): Promise<unknown>
  revokeDevice(deviceId: string): Promise<unknown>
  getReadingPosition(sessionId: string): Promise<ReadingPositionResponse>
  saveReadingPosition(sessionId: string, position: ReadingPosition): Promise<ReadingPositionResponse>
}

export interface PersistedDraft {
  revision: number
  text: string
  attachments: AttachmentDescriptor[]
}

export interface PersistedQueue {
  revision: number
  intents: ClientCommand[]
}

export interface ApplicationPersistence {
  readDraft(sessionId: string): Promise<PersistedDraft>
  saveDraft(
    sessionId: string,
    generation: string,
    revision: number,
    text: string,
    attachments: AttachmentDescriptor[],
  ): Promise<PersistedDraft>
  readQueue(sessionId: string): Promise<PersistedQueue>
  saveQueue(sessionId: string, generation: string, revision: number, intents: ClientCommand[]): Promise<PersistedQueue>
  readReceipt(commandId: string): Promise<CommandResult | null>
}

export interface ApplicationClient extends ApplicationOperations {
  profiles?: (deviceId: string) => ExecutionProfileAccess
  continuity?: (deviceId: string) => ContinuityAccess
  profileRouting?: (deviceId: string) => ProfileRoutingAccess
  readonly persistence?: ApplicationPersistence
  readonly attachments: AttachmentAccess
  start(): Promise<void>
  close(): void
  logout(): Promise<void>
  devices(): Promise<Device[]>
  selectTarget(deviceId: string, sessionId: string | null): void
  resetTarget(): void
  history(sessionId: string, latest?: boolean): Promise<EventEnvelope[] | null>
  historyPage(sessionId: string, direction: HistoryPageDirection, edge?: string): Promise<EventEnvelope[] | HistoryPageSkip>
  send(command: ClientCommand): Promise<CommandResult>
  retryPending(commandId?: string): Promise<CommandResult>
  checkPending(commandId: string): Promise<CommandResult>
}
