import { afterEach, expect, it } from "vitest"
import { ErrorCode, SessionStatus, ConnectionStatus, CommandStatus, FrameType } from "@protocol"
import { PromptStatus } from "@/entities/session"
import { PromptDeliveryMode } from "../src/features/send-command/config/values"
import { terminalSession, snapshot } from "../.storybook/fixtures/session"
import { cleanupPromptOutboxFixtures, fixture, tick } from "./prompt-outbox-fixture"

afterEach(cleanupPromptOutboxFixtures)

it("queues during work and releases one message per source lifecycle, not UI object updates", async () => {
  const { store, send, enqueue, update } = fixture(SessionStatus.Running)

  enqueue("first")
  enqueue("second")
  expect(send).not.toHaveBeenCalled()
  update(SessionStatus.Idle, 2)
  await tick()
  expect(send.mock.calls.map(([command]) => command.commandId)).toEqual(["first"])

  store.getState().setState((state) => ({
    ...state,
    snapshot: { ...state.snapshot!, sessions: state.snapshot!.sessions.map((session) => ({ ...session, lastMessageAt: 5 })) },
  }))

  await tick()
  expect(send).toHaveBeenCalledTimes(1)
  update(SessionStatus.Running, 3)
  update(SessionStatus.Idle, 4)
  await tick()
  expect(send.mock.calls.map(([command]) => command.commandId)).toEqual(["first", "second"])
  expect(store.getState().outbox).toEqual([])
})

it("keeps uncertain delivery in its session queue and checks without resending", async () => {
  const { store, send, check, enqueue, dispatcher } = fixture(SessionStatus.Running)

  send.mockImplementation(async (command) => ({ commandId: command.commandId, status: CommandStatus.Unknown }))
  enqueue("uncertain")
  enqueue("later")

  store
    .getState()
    .setState((state) => ({ ...state, snapshot: { ...state.snapshot!, sessions: [{ ...terminalSession, status: SessionStatus.Idle }] } }))

  await tick()
  const item = store.getState().outbox[0]!

  expect(item.status).toBe(PromptStatus.Unknown)
  store.getState().cancelPrompt("uncertain")
  expect(store.getState().outbox).toHaveLength(2)
  await dispatcher.deliver(item, PromptDeliveryMode.Check)
  expect(check).toHaveBeenCalledWith("uncertain")
  expect(send).toHaveBeenCalledTimes(1)
  expect(store.getState().outbox[1]!.status).toBe(PromptStatus.Queued)
})

it("retains stale work without sending it to a replacement generation and clears on expiry", async () => {
  const { store, send, enqueue, update } = fixture(SessionStatus.Running)

  enqueue("old", { ...terminalSession, generation: "old-generation" })
  update(SessionStatus.Idle, 2)
  await tick()
  expect(send).not.toHaveBeenCalled()
  store.getState().receiveFrame({ type: FrameType.Snapshot, deviceId: "fixture-mac", connectors: [], snapshot })
  expect(store.getState().outbox[0]!.status).toBe(PromptStatus.Stale)
  store.getState().setConnection(ConnectionStatus.Expired)
  expect(store.getState().outbox).toEqual([])
})

it("does not resurrect cleared messages when a late transport result completes", async () => {
  const { store, send, enqueue, update } = fixture(SessionStatus.Running)
  let finish!: (result: { commandId: string; status: typeof CommandStatus.Unknown }) => void

  send.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )

  enqueue("late")
  update(SessionStatus.Idle, 2)
  store.getState().setConnection(ConnectionStatus.Expired)
  finish({ commandId: "late", status: "unknown" })
  await tick()
  expect(store.getState().outbox).toEqual([])
  expect(store.getState().error).toBe("")
})

it("continues after a definitive rejection is removed without waiting for source activity", async () => {
  const { store, send, enqueue, update } = fixture(SessionStatus.Running)

  send.mockImplementationOnce(async (command) => ({
    commandId: command.commandId,
    status: CommandStatus.Rejected,
    code: ErrorCode.INVALID_PROMPT,
  }))

  enqueue(CommandStatus.Rejected)
  enqueue("second")
  update(SessionStatus.Idle, 2)
  await tick()
  expect(store.getState().outbox[0]!.status).toBe(PromptStatus.Failed)
  store.getState().cancelPrompt(CommandStatus.Rejected)
  await tick()
  expect(send.mock.calls.map(([command]) => command.commandId)).toEqual([CommandStatus.Rejected, "second"])
})

it("retains accepted status after a failed receipt read so reconciliation can continue", async () => {
  const { store, send, check, enqueue, dispatcher, update } = fixture(SessionStatus.Running)

  send.mockImplementation(async (command) => ({ commandId: command.commandId, status: CommandStatus.Accepted }))
  enqueue("accepted")
  update(SessionStatus.Idle, 2)
  await tick()
  check.mockRejectedValueOnce(new Error(ErrorCode.NETWORK_UNAVAILABLE))
  await dispatcher.deliver(store.getState().outbox[0]!, PromptDeliveryMode.Check)
  expect(store.getState().outbox[0]!.status).toBe(PromptStatus.Accepted)
  check.mockResolvedValueOnce({ commandId: "accepted", status: CommandStatus.Dispatched })
  await dispatcher.deliver(store.getState().outbox[0]!, PromptDeliveryMode.Check)
  expect(store.getState().outbox).toEqual([])
  expect(send).toHaveBeenCalledTimes(1)
})

it.each(["generation", "device", "stream"])("releases an obsolete lifecycle barrier for a replacement %s", async (kind) => {
  const { store, send, enqueue, update } = fixture(SessionStatus.Running)

  enqueue("old")
  update(SessionStatus.Idle, 2)
  await tick()

  const replacement = {
    ...terminalSession,
    generation: kind === "generation" ? "replacement" : terminalSession.generation,
    target: { ...terminalSession.target, deviceId: kind === "device" ? "replacement-device" : "fixture-mac" },
    lastEventAt: 2,
  }

  const streamId = kind === "stream" ? "replacement-stream" : "fixture"

  store.getState().setState((state) => ({
    ...state,
    deviceId: replacement.target.deviceId,
    snapshot: { ...state.snapshot!, cursor: { streamId, seq: 0 }, sessions: [replacement] },
  }))

  enqueue("new", replacement, streamId)
  await tick()
  expect(send.mock.calls.map(([command]) => command.commandId)).toEqual(["old", "new"])
})
