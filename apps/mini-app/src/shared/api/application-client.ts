import type {
  AccountPreferences,
  AttachmentDescriptor,
  ClientCommand,
  CommandResult,
  EventEnvelope,
  HistoryMessage,
  HistoryNavigationDirection,
  HistoryPageDirection,
  PreferencePatch,
  ReadingPosition,
  ReadingPositionResponse,
  ExecutionProfileAccess,
  ContinuityAccess,
  ProfileRoutingAccess,
  SessionFile,
  AnalyticsQuery,
  AnalyticsReport,
  RulesReply,
  RulesRequest,
  SessionRemoval,
  ModelChoice,
  SessionSkills,
  ProviderFilterValue,
  Session,
  ProjectSession,
} from "@protocol"
import type { AttachmentAccess } from "./attachment-access"
import type { Device, HistoryPageSkip } from "./types"

export interface ApplicationOperations {
  listSessions?(
    deviceId: string,
    provider: ProviderFilterValue,
    cursor?: string,
  ): Promise<{ sessions: Session[]; nextCursor: string | null }>
  getPreferences(): Promise<AccountPreferences>
  savePreferences(patch: PreferencePatch): Promise<AccountPreferences>
  renameSession(sessionId: string, title: string, generation: string): Promise<unknown>
  /** Pins or unpins a session on its device; the device's next snapshot shows the result. */
  pinSession(sessionId: string, generation: string, pinned: boolean): Promise<unknown>
  /** Hides, archives or ends a session on its device; the session leaves the device's next snapshot. */
  removeSession(sessionId: string, generation: string, mode: SessionRemoval): Promise<unknown>
  /** Switches a session to another model on its device; its next turn uses it. */
  switchSessionModel(sessionId: string, generation: string, choice: ModelChoice): Promise<unknown>
  /** Starts a session in one of the device's projects (a shared VM's projects root); resolves with its id. */
  createProjectSession(deviceId: string, session: ProjectSession): Promise<{ sessionId: string }>
  /** The text of a file the session changed, read on its device. */
  readSessionFile(sessionId: string, generation: string, path: string): Promise<SessionFile>
  /** Token usage, cost and plan limits counted on the device. */
  usageReport(deviceId: string, query: AnalyticsQuery): Promise<AnalyticsReport>
  /** Lists or changes the owner's rules for agents' commands, kept on the device. */
  rules(deviceId: string, request: RulesRequest): Promise<RulesReply>
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
  sessionSkills?: (sessionId: string, generation: string) => Promise<SessionSkills>
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
  /** The owner's messages of the whole conversation, text shortened: the message rail's map. */
  historyOutline?(sessionId: string): Promise<HistoryMessage[]>
  /** A short code that links the Chrome extension to this owner; absent where the host cannot issue one. */
  createLinkCode?(): Promise<{ code: string; expiresAt: number }>
  /** The conversation's messages that hold the words, shortened around the first match. */
  historySearch?(sessionId: string, query: string): Promise<HistoryMessage[]>
  /** A fresh window around one message (its position cursor when the outline gave one); null when no longer current. */
  historyAround?(sessionId: string, messageId: string, cursor?: string): Promise<EventEnvelope[] | null>
  /**
   * One page of a subagent's own transcript, kept apart from the parent feed; absent where the host cannot read it.
   * Latest returns null when the response is no longer current; Before/After return a skip reason like `historyPage`.
   */
  subagentHistory?(
    sessionId: string,
    agentId: string,
    direction: HistoryNavigationDirection,
    edge?: string,
  ): Promise<EventEnvelope[] | HistoryPageSkip | null>
  send(command: ClientCommand): Promise<CommandResult>
  retryPending(commandId?: string): Promise<CommandResult>
  checkPending(commandId: string): Promise<CommandResult>
}
