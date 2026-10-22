import { afterEach, expect, it, vi } from "vitest"
import { CommandStatus, HttpStatus, MessageRole, SessionStatus } from "@protocol"
import { promptEchoes } from "@/entities/session"
import { PROMPT_ECHO_TTL_MS } from "@/entities/session/model/store/outbox/constants"
import { terminalSession } from "../.storybook/fixtures/session"
import { cleanupPromptOutboxFixtures, fixture } from "./prompt-outbox-fixture"

afterEach(cleanupPromptOutboxFixtures)

const owner = (id: string) => ({ id, role: MessageRole.User, text: id, occurredAt: 1 })

function shown(store: ReturnType<typeof fixture>["store"], now?: number) {
  const state = store.getState()

  return promptEchoes(state, terminalSession.id, state.session.messages[terminalSession.id] ?? [], now).map((message) => message.text)
}

function receive(store: ReturnType<typeof fixture>["store"], ...ids: string[]) {
  store.getState().setState((state) => ({
    ...state,
    messages: { ...state.messages, [terminalSession.id]: [...(state.messages[terminalSession.id] ?? []), ...ids.map(owner)] },
  }))
}

it("shows a prompt in the feed from the moment it is sent until the agent records it", async () => {
  const { store, send, enqueue } = fixture()
  let deliver!: () => void

  receive(store, "earlier")

  send.mockImplementation(
    (command) => new Promise((resolve) => (deliver = () => resolve({ commandId: command.commandId, status: CommandStatus.Dispatched }))),
  )

  enqueue("first prompt")
  await vi.waitFor(() => expect(shown(store)).toEqual(["first prompt"]))
  deliver()
  await vi.waitFor(() => expect(store.getState().outbox).toHaveLength(0))
  expect(shown(store)).toEqual(["first prompt"])
  receive(store, "recorded")
  expect(shown(store)).toEqual([])
})

it("keeps each echo until its own record arrives, and drops failed or expired ones", async () => {
  const { store, send, enqueue, update } = fixture()

  enqueue("one")
  await vi.waitFor(() => expect(store.getState().outbox).toHaveLength(0))
  // The agent takes the first prompt, so the next one may go.
  update(SessionStatus.Running, 2)
  update(SessionStatus.Idle, 3)
  enqueue("two")
  await vi.waitFor(() => expect(shown(store)).toEqual(["one", "two"]))
  receive(store, "record-one")
  expect(shown(store)).toEqual(["two"])
  expect(shown(store, Date.now() + PROMPT_ECHO_TTL_MS + 1)).toEqual([])

  send.mockRejectedValueOnce(Object.assign(new Error("INVALID_REQUEST"), { status: HttpStatus.BadRequest }))
  update(SessionStatus.Running, 4)
  update(SessionStatus.Idle, 5)
  enqueue("three")
  await vi.waitFor(() => expect(store.getState().outbox[0]?.status).toBe("failed"))
  expect(shown(store)).toEqual(["two"])
})

it("keeps a prompt the relay accepted in the feed until the device delivers it, never back in the queue", async () => {
  const { store, send, enqueue } = fixture()

  send.mockImplementation(async (command) => ({ commandId: command.commandId, status: CommandStatus.Accepted }))
  enqueue("accepted prompt")
  await vi.waitFor(() => expect(store.getState().outbox[0]?.status).toBe(CommandStatus.Accepted))
  expect(shown(store)).toEqual(["accepted prompt"])
  store.getState().finishPrompt({ commandId: "accepted prompt", status: CommandStatus.Dispatched })
  expect(store.getState().outbox).toHaveLength(0)
  expect(shown(store)).toEqual(["accepted prompt"])
})
