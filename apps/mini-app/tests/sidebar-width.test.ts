import { expect, it } from "vitest"
import { SidebarKey, SidebarWidth } from "../src/widgets/session-sidebar/config/values.js"
import { clampSidebarWidth, keyedSidebarWidth, parseSidebarWidth } from "../src/widgets/session-sidebar/lib/sidebar-width.js"

it("keeps the sidebar width inside its bounds and on whole pixels", () => {
  expect(clampSidebarWidth(SidebarWidth.Min - 50)).toBe(SidebarWidth.Min)
  expect(clampSidebarWidth(SidebarWidth.Max + 50)).toBe(SidebarWidth.Max)
  expect(clampSidebarWidth(300.6)).toBe(301)
})

it("falls back to the default width for a missing or malformed stored value", () => {
  expect(parseSidebarWidth(null)).toBe(SidebarWidth.Default)
  expect(parseSidebarWidth("")).toBe(SidebarWidth.Default)
  expect(parseSidebarWidth("wide")).toBe(SidebarWidth.Default)
  expect(parseSidebarWidth("Infinity")).toBe(SidebarWidth.Default)
  expect(parseSidebarWidth("9999")).toBe(SidebarWidth.Max)
  expect(parseSidebarWidth("360")).toBe(360)
})

it("moves the width by a step with the arrows and to the bounds with Home and End", () => {
  expect(keyedSidebarWidth(SidebarKey.Right, 300)).toBe(300 + SidebarWidth.KeyStep)
  expect(keyedSidebarWidth(SidebarKey.Left, 300)).toBe(300 - SidebarWidth.KeyStep)
  expect(keyedSidebarWidth(SidebarKey.Left, SidebarWidth.Min)).toBe(SidebarWidth.Min)
  expect(keyedSidebarWidth(SidebarKey.Home, 300)).toBe(SidebarWidth.Min)
  expect(keyedSidebarWidth(SidebarKey.End, 300)).toBe(SidebarWidth.Max)
  expect(keyedSidebarWidth(SidebarKey.Enter, 300)).toBeUndefined()
})
