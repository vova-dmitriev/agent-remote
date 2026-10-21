import { expect, it, vi } from "vitest"
import {
  ActivityKind,
  EventType,
  HistoryDirection,
  HistoryQueryKey,
  MessageRole,
  ToolActivityPhase,
  type EventEnvelope,
  type HistoryMessage,
} from "@protocol"
import { HistoryPageSkip } from "../src/shared/api"
import { SubagentHistory } from "../src/entities/session/api/subagent-history"
import {
  foldToolResults,
  mergeSubagentPage,
  oldestCursor,
  railActiveId,
  railEntries,
} from "../src/pages/session/lib/history/subagent-history"
import { SUBAGENT_MESSAGE_LIMIT } from "../src/pages/session/config/subagent"

let seq = 0

const event = (payload: unknown, type: EventEnvelope["type"] = EventType.Message): EventEnvelope =>
  ({
    version: 1,
    deviceId: "synthetic-device",
    streamId: "synthetic-stream",
    seq: ++seq,
    eventId: "synthetic-event-" + seq,
    sessionId: "synthetic-session",
    occurredAt: 1,
    type,
    payload,
  }) as EventEnvelope

const text = (id: string, occurredAt: number, extra: Partial<HistoryMessage> = {}): HistoryMessage => ({
  id,
  role: MessageRole.Assistant,
  text: "Synthetic " + id,
  occurredAt,
  ...extra,
})

const call = (id: string, toolId: string, occurredAt: number): HistoryMessage =>
  text(id, occurredAt, {
    text: "npm test",
    tool: { id: toolId, phase: ToolActivityPhase.Started, name: "Bash", kind: ActivityKind.Command },
  })

const result = (id: string, toolId: string, occurredAt: number, phase: ToolActivityPhase): HistoryMessage =>
  text(id, occurredAt, { role: MessageRole.User, text: "", tool: { id: toolId, phase } })

it("merges transcript pages by id in time order and ignores non-message events and invalid items", () => {
  const first = mergeSubagentPage([], [event(text("b", 2)), event(text("a", 1)), event({ id: "broken" })])
  const second = mergeSubagentPage(first, [event({ ...text("b", 2), text: "Updated" }), event(text("c", 3)), event({}, EventType.Status)])

  expect(first.map((message) => message.id)).toEqual(["a", "b"])
  expect(second.map((message) => message.id)).toEqual(["a", "b", "c"])
  expect(second[1]!.text).toBe("Updated")
})

it("bounds the window from the far end of the paging direction", () => {
  const many = Array.from({ length: SUBAGENT_MESSAGE_LIMIT + 5 }, (_, index) => event(text("m" + index, index)))

  expect(mergeSubagentPage([], many)[0]!.id).toBe("m5")
  expect(mergeSubagentPage([], many, HistoryDirection.Before).at(-1)!.id).toBe("m" + (SUBAGENT_MESSAGE_LIMIT - 1))
})

it("replaces the window when a latest page shares no item with it, so missed polls leave no silent hole", () => {
  const loaded = mergeSubagentPage([], [event(text("a", 1)), event(text("b", 2))])

  const appended = Array.from({ length: 100 }, (_, index) =>
    event(text("late-" + index, 100 + index, { historyCursor: "position:" + index })),
  )

  const replaced = mergeSubagentPage(loaded, appended)

  expect(replaced).toHaveLength(100)
  expect(replaced[0]!.id).toBe("late-0")
  expect(oldestCursor(replaced)).toBe("position:0")
  expect(mergeSubagentPage(loaded, [event(text("b", 2)), event(text("c", 3))]).map((m) => m.id)).toEqual(["a", "b", "c"])
  expect(mergeSubagentPage(loaded, appended, HistoryDirection.Before)).toHaveLength(102)
  expect(mergeSubagentPage(loaded, [])).toEqual(loaded)
})

it("marks only the owner's messages on the rail and maps whatever is being read to the owner's message before it", () => {
  const you = (id: string, at: number) => text(id, at, { role: MessageRole.User })
  const items = [you("ask", 1), call("use-1", "tool-1", 2), text("answer", 3), you("again", 4), text("reply", 5)]
  const rail = railEntries(items, [0, 100, 140, 180, 220])

  expect(rail.messages.map((message) => message.id)).toEqual(["ask", "again"])
  expect(rail.starts).toEqual([0, 180])
  expect(railActiveId(items, "use-1")).toBe("ask")
  expect(railActiveId(items, "answer")).toBe("ask")
  expect(railActiveId(items, "again")).toBe("again")
  expect(railActiveId(items, "reply")).toBe("again")
  // Before the owner's first message, the first one after it.
  expect(railActiveId([text("intro", 0), ...items], "intro")).toBe("ask")
  expect(railActiveId(items, null)).toBeNull()
  expect(railActiveId([text("only", 1)], "only")).toBeNull()
})

it("shows each tool call once with the outcome of its loaded result", () => {
  const folded = foldToolResults([
    call("use-1", "tool-1", 1),
    call("use-2", "tool-2", 2),
    result("result-1", "tool-1", 3, ToolActivityPhase.Completed),
    result("result-2", "tool-2", 4, ToolActivityPhase.Failed),
    call("use-3", "tool-3", 5),
    result("orphan", "tool-0", 6, ToolActivityPhase.Completed),
    text("answer", 7),
  ])

  expect(folded.map((message) => [message.id, message.tool?.phase])).toEqual([
    ["use-1", ToolActivityPhase.Completed],
    ["use-2", ToolActivityPhase.Failed],
    ["use-3", ToolActivityPhase.Started],
    ["orphan", ToolActivityPhase.Completed],
    ["answer", undefined],
  ])
})

it("pages earlier items from the oldest loaded cursor", () => {
  expect(oldestCursor([text("a", 1), text("b", 2, { historyCursor: "position:b" }), text("c", 3, { historyCursor: "position:c" })])).toBe(
    "position:b",
  )

  expect(oldestCursor([])).toBeUndefined()
})

it("reads a subagent's latest page with its id on the relay route and pages from its own cursors", async () => {
  const paths: string[] = []

  const request = vi.fn(async (path: string, observe: (response: Response) => void) => {
    paths.push(path)
    observe(new Response(null, { headers: { "x-next-cursor": "source:12" } }))

    return [event(text("a", 1))]
  })

  const history = new SubagentHistory(request, { generation: () => "synthetic-generation" })

  await history.page("session/1", "agent-1", HistoryDirection.Latest, () => true)
  await history.page("session/1", "agent-1", HistoryDirection.Before, () => true)

  expect(paths).toEqual([
    "/sessions/session%2F1/events?" + HistoryQueryKey.AgentId + "=agent-1",
    "/sessions/session%2F1/events?before=source%3A12&" + HistoryQueryKey.AgentId + "=agent-1",
  ])
})

it("keeps subagent cursors apart and drops a response that is no longer current", async () => {
  const request = vi.fn(async (_path: string, observe: (response: Response) => void) => {
    observe(new Response(null, { headers: { "x-next-cursor": "source:1" } }))

    return [event(text("a", 1))]
  })

  const history = new SubagentHistory(request, { generation: () => "synthetic-generation" })

  await history.page("session", "first", HistoryDirection.Latest, () => true)
  expect(await history.page("session", "second", HistoryDirection.Before, () => true)).toBe(HistoryPageSkip.Stale)
  expect(await history.page("session", "first", HistoryDirection.Latest, () => false)).toBeNull()
  history.reset()
  expect(await history.page("session", "first", HistoryDirection.Before, () => true)).toBe(HistoryPageSkip.Stale)
  expect(request).toHaveBeenCalledTimes(1)
})
