import { expect, it } from "vitest"
import {
  SessionStatus,
  ConnectionStatus,
  FrameType,
  CommandActionType,
  CommandStatus,
  type ClientCommand,
  type CommandResult,
} from "@protocol"
import type { AppTransport } from "../src/app/api"
import { createSessionStore } from "../src/entities/session/model/store/create-session-store"
import { terminalSession, snapshot } from "../.storybook/fixtures/session"
import { PromptDispatcher } from "../src/features/send-command/model/outbox/dispatcher"

it("keeps typing queued during HTTP and waits for a fresh idle snapshot between prompts", async () => {
  const store = createSessionStore()
  const sent: ClientCommand[] = []

  let finish: (result: CommandResult) => void = () => {}

  const client = {
    send: (command: ClientCommand) => {
      sent.push(command)

      return new Promise<CommandResult>((resolve) => {
        finish = resolve
      })
    },
  } as unknown as AppTransport

  store.getState().runtime.attach(client)
  store.getState().setConnection(ConnectionStatus.Online)
  store.getState().receiveFrame({ type: FrameType.Snapshot, deviceId: "fixture-mac", snapshot, connectors: [] })
  const dispatcher = new PromptDispatcher(store)
  const stop = dispatcher.start()

  for (const commandId of ["first", "second"])
    store.getState().enqueuePrompt({
      command: {
        commandId,
        sessionId: terminalSession.id,
        generation: terminalSession.generation,
        target: terminalSession.target,
        action: { type: CommandActionType.Prompt, text: commandId },
      },
      files: [],
      streamId: "fixture",
      runtimeEpoch: store.getState().runtime.epoch,
    })

  expect(sent.map((command) => command.commandId)).toEqual(["first"])
  finish({ commandId: "first", status: CommandStatus.Dispatched })
  await Promise.resolve()
  expect(sent).toHaveLength(1)

  store.getState().receiveFrame({
    type: FrameType.Snapshot,
    deviceId: "fixture-mac",
    snapshot: {
      ...snapshot,
      sessions: [{ ...terminalSession, status: SessionStatus.Running }],
    },
    connectors: [],
  })

  expect(sent).toHaveLength(1)

  store.getState().receiveFrame({
    type: FrameType.Snapshot,
    deviceId: "fixture-mac",
    snapshot: {
      ...snapshot,
      sessions: [{ ...terminalSession }],
    },
    connectors: [],
  })

  expect(sent.map((command) => command.commandId)).toEqual(["first", "second"])
  stop()
})
