import { vi } from "vitest"
import { SessionStatus, ConnectionStatus, CommandStatus, CommandActionType, type Session } from "@protocol"
import { PromptDeliveryMode } from "@/features/send-command/config/values"
import { terminalSession, snapshot } from "../.storybook/fixtures/session"
import { AppTransport } from "@/shared/api/transport"
import { createSessionStore } from "@/entities/session/model/store/create-session-store"
import { PromptDispatcher } from "@/features/send-command/model/outbox/dispatcher"

const cleanups: (() => void)[] = []

export function cleanupPromptOutboxFixtures() {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.restoreAllMocks()
}

export function fixture(status: Session["status"] = SessionStatus.Idle) {
  const store = createSessionStore()
  const transport = new AppTransport("synthetic", { onFrame: () => {}, onConnection: () => {} })
  const lease = store.getState().runtime.attach(transport)
  const dispatcher = new PromptDispatcher(store)

  store.getState().setState((state) => ({
    ...state,
    deviceId: "fixture-mac",
    connection: ConnectionStatus.Online,
    snapshot: { ...snapshot, sessions: [{ ...terminalSession, status }], permissions: [] },
  }))

  const send = vi
    .spyOn(transport, PromptDeliveryMode.Send)
    .mockImplementation(async (command) => ({ commandId: command.commandId, status: CommandStatus.Dispatched }))

  const check = vi.spyOn(transport, "checkPending").mockImplementation(async (id) => ({ commandId: id, status: CommandStatus.Unknown }))

  function enqueue(id: string, source = terminalSession, streamId = "fixture") {
    store.getState().enqueuePrompt({
      command: {
        commandId: id,
        target: source.target,
        sessionId: source.id,
        generation: source.generation,
        action: { type: CommandActionType.Prompt, text: id },
      },
      runtimeEpoch: lease.epoch,
      streamId,
      files: [],
    })
  }

  function update(status: Session["status"], at: number) {
    store
      .getState()
      .setState((state) => ({ ...state, snapshot: { ...state.snapshot!, sessions: [{ ...terminalSession, status, lastEventAt: at }] } }))
  }

  cleanups.push(() => transport.close())
  cleanups.push(dispatcher.start())

  return { store, transport, dispatcher, send, check, enqueue, update }
}

export const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve))
