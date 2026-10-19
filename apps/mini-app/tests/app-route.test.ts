import { expect, it } from "vitest"
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
