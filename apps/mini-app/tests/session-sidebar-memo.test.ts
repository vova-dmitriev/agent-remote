import { describe, expect, it, vi } from "vitest"
import { EventType, FrameType, MessageRole, type EventEnvelope, type ServerFrame } from "@protocol"
import { ProviderFilterValue } from "../src/entities/session/config/session-values.js"
import { createSessionStore } from "../src/entities/session/model/store/create-session-store.js"
import { sessionsAwaitingInput } from "../src/entities/session/lib/selectors.js"
import { sessionSnapshot } from "../../../tests/e2e/support/session-fixtures.js"
import type * as SidebarGroups from "../src/widgets/session-sidebar/lib/sidebar-groups.js"

const groups = vi.hoisted(() => ({ calls: 0 }))

vi.mock("../src/widgets/session-sidebar/lib/sidebar-groups.js", async (importOriginal) => {
  const original = await importOriginal<typeof SidebarGroups>()

  return {
    ...original,
    groupByRecency: (...args: Parameters<typeof original.groupByRecency>) => {
      groups.calls += 1

      return original.groupByRecency(...args)
    },
  }
})

const { createSectionsMemo } = await import("../src/widgets/session-sidebar/lib/sidebar-sections.js")

const DEVICE = "device"
const SESSION = "terminal-session"
const NOW = Date.UTC(2026, 9, 19, 12)

function messageFrame(seq: number, occurredAt: number, id = "message-" + seq): ServerFrame {
  const event: EventEnvelope = {
    version: 1,
    deviceId: DEVICE,
    streamId: "e2e",
    seq,
    eventId: "event-" + seq,
    sessionId: SESSION,
    occurredAt,
    type: EventType.Message,
    payload: { id, role: MessageRole.Assistant, text: "Synthetic " + seq, occurredAt },
  }

  return { type: FrameType.Event, event }
}

describe("desktop sidebar sections across real message frames", () => {
  it("keeps list identity for frames that do not move a session and recomputes once when lastMessageAt moves", () => {
    const store = createSessionStore()
    const actions = store.getState()
    const snapshot = sessionSnapshot(DEVICE)

    snapshot.sessions[0] = { ...snapshot.sessions[0]!, lastMessageAt: 500 }
    actions.receiveFrame({ type: FrameType.Snapshot, deviceId: DEVICE, snapshot, connectors: [] })

    const read = () => store.getState().session.snapshot!
    const sectionsFor = createSectionsMemo()
    const sections = () => sectionsFor({ sessions: read().sessions, query: "", provider: ProviderFilterValue.All, now: NOW })
    const before = read()
    const first = sections()
    const awaiting = () => sessionsAwaitingInput(read().sessions, read().permissions, read().userInputs)

    // (a) An older message (history arriving out of order) does not move lastMessageAt.
    actions.receiveFrame(messageFrame(1, 400))

    expect(store.getState().session.messages[SESSION]).toHaveLength(1)
    expect(read()).toBe(before)
    expect(read().sessions).toBe(before.sessions)
    expect(sections()).toBe(first)
    expect(groups.calls).toBe(1)

    // (b) A newer message replaces only that session object and recomputes the sections once.
    actions.receiveFrame(messageFrame(2, 900))

    const after = read()

    expect(after.sessions).not.toBe(before.sessions)
    expect(after.sessions[0]!.lastMessageAt).toBe(900)
    expect(after.sessions.slice(1)).toEqual(before.sessions.slice(1))
    after.sessions.slice(1).forEach((session, index) => expect(session).toBe(before.sessions[index + 1]))
    expect(after.permissions).toBe(before.permissions)

    const second = sections()

    expect(second).not.toBe(first)
    expect(sections()).toBe(second)
    expect(groups.calls).toBe(2)
    expect([...awaiting()]).toEqual([...sessionsAwaitingInput(before.sessions, before.permissions, before.userInputs)])
  })
})
