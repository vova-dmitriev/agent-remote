import { describe, expect, it, vi } from "vitest"
import type { Session } from "@protocol"
import { ProviderFilterValue } from "../src/entities/session/config/session-values.js"
import { createSessionStore } from "../src/entities/session/model/store/create-session-store.js"
import { sessionSnapshot } from "../../../tests/e2e/support/session-fixtures.js"

const groups = vi.hoisted(() => ({ calls: 0 }))

vi.mock("../src/widgets/session-sidebar/lib/sidebar-groups.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/widgets/session-sidebar/lib/sidebar-groups.js")>()

  return {
    ...original,
    groupByRecency: (...args: Parameters<typeof original.groupByRecency>) => {
      groups.calls += 1

      return original.groupByRecency(...args)
    },
  }
})

const { createSectionsMemo } = await import("../src/widgets/session-sidebar/lib/sidebar-sections.js")

const NOW = Date.UTC(2026, 9, 19, 12)
const selectSessions = (state: ReturnType<ReturnType<typeof createSessionStore>["getState"]>) => state.session.snapshot?.sessions

describe("desktop sidebar sections", () => {
  it("reuses the sections when only messages change and recomputes for a new snapshot, query or tick", () => {
    const store = createSessionStore()
    const snapshot = sessionSnapshot("device")

    store.getState().setState((state) => ({ ...state, snapshot }))

    const sectionsFor = createSectionsMemo()
    const input = (sessions: Session[], query = "", now = NOW) => ({ sessions, query, provider: ProviderFilterValue.All, now })
    const before = selectSessions(store.getState())!
    const first = sectionsFor(input(before))

    store.getState().setState((state) => ({
      ...state,
      messages: { ...state.messages, [before[0]!.id]: [] },
      messageVersions: { ...state.messageVersions, [before[0]!.id]: {} },
    }))

    const after = selectSessions(store.getState())!

    expect(after).toBe(before)
    expect(sectionsFor(input(after))).toBe(first)
    expect(groups.calls).toBe(1)

    sectionsFor(input(after, "codex"))
    sectionsFor(input(after, "codex", NOW + 60_000))
    store.getState().setState((state) => ({ ...state, snapshot: { ...snapshot, sessions: [...snapshot.sessions] } }))
    sectionsFor(input(selectSessions(store.getState())!, "codex", NOW + 60_000))

    expect(groups.calls).toBe(4)
  })
})
