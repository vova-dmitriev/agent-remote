import { expect, it } from "vitest"
import {
  ErrorCode,
  HistoryPageDirection,
  FrameType,
  DeviceStatus,
  EventType,
  MessageRole,
  CommandStatus,
  ConnectionStatus,
  HistoryStatus,
  type EventEnvelope,
  type ServerFrame,
} from "@protocol"
import { createSessionStore } from "../src/entities/session/model/store/create-session-store.js"
import { reduceHistoryWindow } from "../src/entities/session/model/store/history.js"
import { initialState } from "../src/entities/session/model/session-state.js"

function snapshot(deviceId = "device", streamId = "stream"): Extract<ServerFrame, { type: typeof FrameType.Snapshot }> {
  return {
    type: FrameType.Snapshot,
    deviceId,
    connectors: [],
    snapshot: { sessions: [], deviceStatus: DeviceStatus.Online, cursor: { streamId, seq: 0 }, permissions: [], terminal: null },
  }
}

function event(seq: number, id = "message", text = "Synthetic", deviceId = "device"): EventEnvelope {
  return {
    version: 1,
    deviceId,
    streamId: "stream",
    seq,
    eventId: "event-" + seq,
    sessionId: "session",
    occurredAt: seq,
    type: EventType.Message,
    payload: { id, role: MessageRole.Assistant, text, occurredAt: seq },
  }
}

it("isolates app instances and removes all owner data and feedback on expiry", () => {
  const first = createSessionStore(),
    second = createSessionStore()

  const actions = first.getState()

  actions.receiveFrame(snapshot())
  actions.setState((state) => ({ ...state, selectedId: "session" }))
  actions.receiveFrame({ type: FrameType.Event, event: event(1) })
  actions.receiveFrame({ type: FrameType.CommandResult, result: { commandId: "command", status: CommandStatus.Dispatched } })
  actions.setError("Synthetic failure")
  expect(second.getState().session).toEqual(initialState())
  actions.setConnection(ConnectionStatus.Expired)

  expect(first.getState()).toMatchObject({
    session: { ...initialState(), connection: ConnectionStatus.Expired },
    error: "",
    result: "",
    commandResult: undefined,
  })

  expect(first.getState().receiveFrame).toBe(actions.receiveFrame)
  expect(first.getState().setState).toBe(actions.setState)
  actions.receiveFrame(snapshot("next-owner-device", "next-owner-stream"))
  expect(first.getState().session.messages).toEqual({})
  expect(first.getState().session.selectedId).toBeNull()
})

it("publishes command feedback atomically and keeps React-compatible functional actions stable", () => {
  const store = createSessionStore()
  const seen: string[] = []
  const unsubscribe = store.subscribe((state) => seen.push(state.result + ":" + state.commandResult?.status))

  store.getState().receiveFrame({
    type: FrameType.CommandResult,
    result: { commandId: "one", status: CommandStatus.Rejected, code: ErrorCode.STALE_SESSION },
  })

  unsubscribe()
  expect(seen).toEqual(["STALE_SESSION:rejected"])
  store.getState().setError("one")
  store.getState().setError((previous) => previous + " two")
  expect(store.getState().error).toBe("one two")
  store.getState().reset(ConnectionStatus.Online)
  expect(store.getState().session.connection).toBe(ConnectionStatus.Online)
  expect(store.getState().commandResult).toBeUndefined()
})

it("preserves ordered reduction, rejects foreign devices and bounds messages and versions together", () => {
  const store = createSessionStore()
  const actions = store.getState()

  actions.receiveFrame(snapshot())
  actions.receiveFrame({ type: FrameType.Event, event: event(2, "same", "Newest") })
  actions.receiveFrame({ type: FrameType.Event, event: event(1, "same", "Stale") })
  actions.receiveFrame({ type: FrameType.Event, event: event(3, "foreign", "Other owner", "foreign-device") })
  expect(store.getState().session.messages.session?.map((message) => message.text)).toEqual(["Newest"])

  for (let seq = 3; seq <= 510; seq++) actions.receiveFrame({ type: FrameType.Event, event: event(seq, "message-" + seq) })

  const session = store.getState().session

  expect(session.messages.session).toHaveLength(500)
  expect(Object.keys(session.messageVersions.session ?? {})).toHaveLength(500)
  expect(session.messages.session?.[0]?.id).toBe("message-11")
  actions.receiveFrame(snapshot("device", "replacement-stream"))
  expect(store.getState().session.messages).toEqual({})
  expect(store.getState().session.messageVersions).toEqual({})
})

it("preserves history through a temporary disconnect but resets it on explicit owner reset", () => {
  const store = createSessionStore()

  store.getState().receiveFrame(snapshot())
  store.getState().receiveFrame({ type: FrameType.Event, event: event(1) })
  store.getState().setHistoryStatus("session", HistoryStatus.Ready)
  store.getState().setConnection(ConnectionStatus.Offline)
  expect(store.getState().session.messages.session).toHaveLength(1)
  expect(store.getState().session.history).toEqual({ sessionId: "session", status: HistoryStatus.Ready })
  store.getState().reset()
  expect(store.getState().session).toEqual(initialState())
})

it("publishes a restored history window and ready status in one synchronous commit", () => {
  const store = createSessionStore()

  store.getState().receiveFrame(snapshot())
  store.getState().setState((state) => ({ ...state, selectedId: "session" }))
  store.getState().setHistoryStatus("session", HistoryStatus.Loading)
  const seen: { status: string | undefined; count: number }[] = []

  const unsubscribe = store.subscribe(({ session }) =>
    seen.push({ status: session.history?.status, count: session.messages.session?.length ?? 0 }),
  )

  store.getState().receiveHistory("session", [event(1, "one"), event(2, "two")])
  unsubscribe()
  expect(seen).toEqual([{ status: HistoryStatus.Ready, count: 2 }])
})

it("keeps live revisions arriving after the latest-page request while discarding the old window", async () => {
  const store = createSessionStore()

  store.getState().receiveFrame(snapshot())
  store.getState().receiveFrame({ type: FrameType.Event, event: event(1, "old-window") })
  store.getState().receiveFrame({ type: FrameType.Event, event: event(2, "streamed", "Draft") })
  const baseline = new Map(store.getState().session.messages.session!.map((message) => [message.id, message]))
  let resolve!: (events: EventEnvelope[]) => void

  const response = new Promise<EventEnvelope[]>((done) => {
    resolve = done
  })

  const pending = response.then((events) =>
    store.getState().setState((state) => reduceHistoryWindow(state, "session", events, HistoryPageDirection.After, true, baseline)),
  )

  store.getState().receiveFrame({ type: FrameType.Event, event: event(3, "streamed", "Completed live") })
  store.getState().receiveFrame({ type: FrameType.Event, event: event(4, "new-live", "Arrived during request") })
  resolve([event(2, "streamed", "Draft"), event(2, "latest-page", "Server snapshot")])
  await pending
  const state = store.getState().session

  expect(state.messages.session?.map((message) => message.text)).toEqual(["Server snapshot", "Completed live", "Arrived during request"])
  expect(state.messageVersions.session?.streamed?.seq).toBe(3)
  expect(state.messageVersions.session?.["new-live"]?.seq).toBe(4)
  expect(state.messageVersions.session?.["old-window"]).toBeUndefined()
})
