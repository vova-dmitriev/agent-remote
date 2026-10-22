import type { CommandResult, EventEnvelope, ServerFrame } from "@protocol"
import type { Connection, HistoryStatus } from "@/shared/api"
import type { TransportRuntime } from "@/shared/lib/runtime"
import type { ProviderFilterValue } from "@/entities/session/config/session-values"
import type { SessionState } from "../session-state"
import type { PromptEcho, PromptIntent, PromptStatus, QueuedPrompt } from "./outbox/types"

type Update<T> = T | ((previous: T) => T)

export interface SessionStoreData {
  providerFilter: ProviderFilterValue
  outbox: QueuedPrompt[]
  /** Prompts shown in the feed before the agent records them. */
  echoes: PromptEcho[]
  session: SessionState
  error: string
  result: string
  commandResult: CommandResult | undefined
}

interface SessionStoreActions {
  setProviderFilter: (provider: ProviderFilterValue) => void
  enqueuePrompt: (item: PromptIntent) => boolean
  beginPromptEdit: (commandId: string) => boolean
  savePromptEdit: (commandId: string, text: string) => boolean
  cancelPromptEdit: (commandId: string) => void
  updatePrompt: (commandId: string, status: PromptStatus, code?: string) => void
  /** Marks a prompt sending and shows it in the feed at once. */
  sendingPrompt: (item: QueuedPrompt) => void
  finishPrompt: (receipt: CommandResult) => void
  cancelPrompt: (commandId: string) => void
  setState: (update: Update<SessionState>) => void
  setError: (update: Update<string>) => void
  setResult: (update: Update<string>) => void
  setConnection: (connection: Connection) => void
  setHistoryStatus: (sessionId: string, status: HistoryStatus) => void
  receiveHistory: (sessionId: string, events: EventEnvelope[]) => void
  receiveFrame: (frame: ServerFrame) => void
  reset: (connection?: Connection) => void
  resetDeviceState: () => void
}

interface SessionStoreServices {
  runtime: TransportRuntime
}

export type SessionStoreState = SessionStoreData & SessionStoreActions & SessionStoreServices
