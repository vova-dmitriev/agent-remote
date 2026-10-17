import { afterEach, expect, it } from "vitest"
import { CommandActionType, CommandStatus, ErrorCode, SessionStatus } from "@protocol"
import { PromptStatus } from "@/entities/session"
import { PromptDeliveryMode } from "@/features/send-command/config/values"
import { cleanupPromptOutboxFixtures, fixture, tick } from "./prompt-outbox-fixture"

afterEach(cleanupPromptOutboxFixtures)

it("holds an edit when the source becomes idle, then sends the saved text in the original position", async () => {
  const { store, enqueue, update, send } = fixture(SessionStatus.Running)

  enqueue("first")
  enqueue("second")
  expect(store.getState().beginPromptEdit("first")).toBe(true)
  update(SessionStatus.Idle, 2)
  await tick()
  expect(send).not.toHaveBeenCalled()
  expect(store.getState().savePromptEdit("first", "Edited instruction")).toBe(true)
  await tick()
  expect(send.mock.calls[0]![0]).toMatchObject({ commandId: "first", action: { type: "prompt", text: "Edited instruction" } })
  expect(store.getState().outbox.map((item) => item.command.commandId)).toEqual(["second"])
})

it("cancels an edit without losing the original text or attachments", async () => {
  const { store, enqueue } = fixture(SessionStatus.Running)

  enqueue("original")
  const file = new File(["synthetic bytes"], "example.txt")

  const attachment = {
    id: "synthetic-file",
    name: "example.txt",
    mimeType: "text/plain",
    byteLength: 15,
    sha256: "a".repeat(64),
    kind: "file" as const,
  }

  const item = store.getState().outbox[0]!

  store.setState({
    outbox: [
      {
        ...item,
        files: [file],
        command: { ...item.command, action: { type: CommandActionType.Prompt, text: "original", attachments: [attachment] } },
      },
    ],
  })

  store.getState().beginPromptEdit("original")
  store.getState().cancelPromptEdit("original")

  expect(store.getState().outbox[0]).toMatchObject({
    status: "queued",
    command: { action: { text: "original", attachments: [attachment] } },
  })

  expect(store.getState().outbox[0]!.files[0]).toBe(file)
  store.getState().beginPromptEdit("original")
  store.getState().savePromptEdit("original", "Changed text")
  expect(store.getState().outbox[0]!.command.action).toMatchObject({ text: "Changed text", attachments: [attachment] })
})

it("keeps invalid edits in the editor and never changes uncertain or already sent intent", async () => {
  const { store, enqueue, dispatcher } = fixture(SessionStatus.Running)

  enqueue("draft")
  store.getState().beginPromptEdit("draft")
  expect(() => store.getState().savePromptEdit("draft", "\u0000")).toThrow(ErrorCode.INVALID_PROMPT)
  expect(() => store.getState().savePromptEdit("draft", " ")).toThrow(ErrorCode.INVALID_PROMPT)
  expect(store.getState().outbox[0]!.status).toBe(PromptStatus.Editing)
  store.getState().cancelPromptEdit("draft")
  store.getState().updatePrompt("draft", PromptStatus.Unknown)
  expect(store.getState().beginPromptEdit("draft")).toBe(false)
  expect(store.getState().savePromptEdit("draft", "Must not replace uncertain text")).toBe(false)
  await dispatcher.deliver(store.getState().outbox[0]!, PromptDeliveryMode.Send)
  expect(store.getState().outbox[0]!.command.action).toMatchObject({ text: "draft" })
})

it("sends a selected queued message now during work without releasing older queued messages", async () => {
  const { store, enqueue, update, dispatcher, send } = fixture(SessionStatus.Running)

  enqueue("first")
  enqueue("second")
  expect(dispatcher.canSendNow("second")).toBe(true)
  await Promise.all([dispatcher.sendNow("second"), dispatcher.sendNow("second")])
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0]![0]).toMatchObject({ commandId: "second", action: { text: "second", delivery: "immediate" } })
  expect(store.getState().outbox.map((item) => item.command.commandId)).toEqual(["first"])
  update(SessionStatus.Idle, 2)
  await tick()
  expect(send.mock.calls.map(([command]) => command.commandId)).toEqual(["second", "first"])
})

it("does not force through an uncertain receipt, waiting question, lost source or connection", async () => {
  const { store, enqueue, update, dispatcher, send } = fixture(SessionStatus.Running)

  enqueue("uncertain")
  enqueue("later")
  store.getState().updatePrompt("uncertain", PromptStatus.Unknown)
  expect(dispatcher.canSendNow("later")).toBe(false)
  await dispatcher.sendNow("later")
  expect(send).not.toHaveBeenCalled()
  store.getState().finishPrompt({ commandId: "uncertain", status: CommandStatus.Dispatched })
  update(SessionStatus.WaitingInput, 2)
  await dispatcher.sendNow("later")
  expect(send).not.toHaveBeenCalled()
  update(SessionStatus.Running, 3)
  store.getState().runtime.clear()
  await dispatcher.sendNow("later")
  expect(send).not.toHaveBeenCalled()
})
