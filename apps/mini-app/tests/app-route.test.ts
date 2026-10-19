import { expect, it } from "vitest"
import { subagentIdSchema } from "@protocol"
import { AppRoute, parseRoute, sessionRoute, subagentRoute } from "../src/shared/lib/routes/index.js"

it("builds and parses session and subagent routes with encoded ids", () => {
  expect(sessionRoute("synthetic/session")).toBe("#/sessions/synthetic%2Fsession")
  expect(subagentRoute("synthetic", "agent 1")).toBe("#/sessions/synthetic/agents/agent%201")
  expect(parseRoute(sessionRoute("synthetic/session"))).toEqual({ sessionId: "synthetic/session" })
  expect(parseRoute(subagentRoute("synthetic", "agent 1"))).toEqual({ sessionId: "synthetic", agentId: "agent 1" })
  expect(parseRoute(AppRoute.Root)).toEqual({})
})

it("rejects anything that is not an app route", () => {
  for (const hash of [
    "",
    "#",
    "#session=synthetic",
    "#/sessions",
    "#/sessions/",
    "#/sessions/%E0%A4%A",
    "#/sessions/a/agents",
    "#/sessions/a/agents/",
    "#/sessions/a/other/b",
    "#/sessions/a/agents/b/extra",
    "#/other/a",
  ]) {
    expect(parseRoute(hash), hash).toBeNull()
  }
})

it("round-trips subagent routes for every valid subagent id shape", () => {
  const agentIds = ["a3f9c2e1b7d04c55", "agent_7-x", "Z", "x".repeat(128)]
  const sessionIds = ["terminal-session", "synthetic/session #1", "сессия"]

  for (const agentId of agentIds) {
    expect(subagentIdSchema.safeParse(agentId).success, agentId).toBe(true)

    for (const sessionId of sessionIds) {
      const route = subagentRoute(sessionId, agentId)

      expect(parseRoute(route), route).toEqual({ sessionId, agentId })
      expect(parseRoute(sessionRoute(sessionId))).toEqual({ sessionId })
    }
  }
})
