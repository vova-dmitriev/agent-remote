import { createStore } from "zustand/vanilla"
import { ConnectionStatus, ErrorCode, FrameType, LOCAL_AUTH_ERROR_CODES } from "@protocol"
import type { Connection } from "@/shared/api"
import { ProviderFilterValue } from "@/entities/session/config/session-values"
import { TransportRuntime } from "@/shared/lib/runtime"
import { PromptStatus, PROMPT_OUTBOX_BYTES, PROMPT_OUTBOX_LIMIT } from "./outbox/constants"
import { initialState, reduceSessionState } from "../session-state"
import { createPromptEditing } from "./outbox/edit"
import { observePrompt, samePromptSource } from "./outbox/state"
import { echoPrompt } from "./outbox/echo"
import { reduceHistoryWindow } from "./history"
import type { SessionStoreData, SessionStoreState } from "./types"

function emptyData(connection: Connection = ConnectionStatus.Connecting): SessionStoreData {
  return {
    providerFilter: ProviderFilterValue.All,
    outbox: [],
    echoes: [],
    session: { ...initialState(), connection },
    error: "",
    result: "",
    commandResult: undefined,
  }
}

export function createSessionStore(initialProviderFilter: ProviderFilterValue = ProviderFilterValue.All) {
  return createStore<SessionStoreState>()((set, get) => ({
    runtime: new TransportRuntime(),
    ...emptyData(),
    providerFilter: initialProviderFilter,
    setProviderFilter: (providerFilter) => set({ providerFilter }),
    ...createPromptEditing(set, get),
    enqueuePrompt: (item) => {
      const current = get().outbox
      const bytes = [...current.flatMap((entry) => entry.files), ...item.files].reduce((total, file) => total + file.size, 0)

      if (current.length >= PROMPT_OUTBOX_LIMIT || bytes > PROMPT_OUTBOX_BYTES) return false
      set({ outbox: [...current, { ...item, status: PromptStatus.Queued }] })

      return true
    },
    updatePrompt: (id, status, code) =>
      set((current) => ({
        outbox: current.outbox.map((item) => (item.command.commandId === id ? { ...item, status, code } : item)),
      })),
    sendingPrompt: (item) =>
      set((current) => ({
        outbox: current.outbox.map((entry) =>
          entry.command.commandId === item.command.commandId ? { ...item, status: PromptStatus.Sending } : entry,
        ),
        echoes: echoPrompt(current, item),
      })),
    finishPrompt: (receipt) => set((current) => ({ outbox: observePrompt(current.outbox, receipt) })),
    cancelPrompt: (id) =>
      set((current) => ({
        outbox: current.outbox.filter(
          (item) =>
            item.command.commandId !== id ||
            [PromptStatus.Sending, PromptStatus.Accepted, PromptStatus.Unknown].some((candidateValue) => candidateValue === item.status),
        ),
      })),
    setState: (update) => set((current) => ({ session: typeof update === "function" ? update(current.session) : update })),
    setError: (update) => set((current) => ({ error: typeof update === "function" ? update(current.error) : update })),
    setResult: (update) => set((current) => ({ result: typeof update === "function" ? update(current.result) : update })),
    setConnection: (connection) => {
      if (connection === ConnectionStatus.Expired) get().runtime.clear()?.close()

      set((current) =>
        connection === ConnectionStatus.Expired
          ? {
              ...emptyData(connection),
              error: [ErrorCode.TELEGRAM_AUTH_FAILED, ...LOCAL_AUTH_ERROR_CODES].some((code) => code === current.error)
                ? current.error
                : "",
            }
          : { session: { ...current.session, connection } },
      )
    },
    setHistoryStatus: (sessionId, status) => set((current) => ({ session: { ...current.session, history: { sessionId, status } } })),
    receiveHistory: (sessionId, events) => set((current) => ({ session: reduceHistoryWindow(current.session, sessionId, events) })),
    receiveFrame: (frame) =>
      set((current) => {
        const session = reduceSessionState(current.session, frame)
        const next = { ...current, session }
        const outbox = frame.type === FrameType.CommandResult ? observePrompt(current.outbox, frame.result) : current.outbox

        return {
          session,
          outbox:
            frame.type === FrameType.Snapshot
              ? outbox.map((item) => (samePromptSource(item, next, item.runtimeEpoch) ? item : { ...item, status: PromptStatus.Stale }))
              : outbox,
          ...(frame.type === FrameType.Error ? { error: frame.code } : {}),
          ...(frame.type === FrameType.CommandResult
            ? { result: frame.result.code ?? frame.result.status, commandResult: frame.result }
            : {}),
        }
      }),
    reset: (connection) => set(emptyData(connection)),
    resetDeviceState: () => set(emptyData(get().session.connection)),
  }))
}
