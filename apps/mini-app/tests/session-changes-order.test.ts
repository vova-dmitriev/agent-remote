import { expect, it } from "vitest"
import { newestChangesFirst } from "@/entities/session/lib/changes/order"

const file = (path: string, changedAt?: number) => ({
  id: path,
  path,
  kind: "update" as const,
  patch: "",
  truncated: false,
  ...(changedAt ? { changedAt } : {}),
})

it("lists the most recently changed files first, and the latest listed first where no time is known", () => {
  expect(newestChangesFirst([file("a", 1), file("b", 3), file("c", 2)]).map((change) => change.path)).toEqual(["b", "c", "a"])
  expect(newestChangesFirst([file("old"), file("new")]).map((change) => change.path)).toEqual(["new", "old"])
})
