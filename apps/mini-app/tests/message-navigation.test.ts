import { describe, expect, it } from "vitest"
import { PreviewSource } from "../src/pages/session/config/message-navigation"
import { navigationScrollBehavior, previewDismissal } from "../src/pages/session/lib/message-navigation"

describe("message navigation", () => {
  it("animates explicit navigation unless reduced motion is requested", () => {
    expect(navigationScrollBehavior(false)).toBe("smooth")
    expect(navigationScrollBehavior(true)).toBe("auto")
  })

  it("keeps a jumped-to preview dismissed through subsequent focus and pointer events", () => {
    const gate = previewDismissal()

    gate.dismiss("first")
    expect(gate.allows("first", PreviewSource.Hover)).toBe(false)
    expect(gate.allows("first", PreviewSource.Focus)).toBe(false)
    expect(gate.allows("second", PreviewSource.Focus)).toBe(true)
    expect(gate.allows("second", PreviewSource.Hover)).toBe(false)
    gate.leave(PreviewSource.Hover)
    expect(gate.allows("first", PreviewSource.Hover)).toBe(true)
    expect(gate.allows("first", PreviewSource.Focus)).toBe(false)
    gate.leave(PreviewSource.Focus)
    expect(gate.allows("first", PreviewSource.Focus)).toBe(true)
  })

  it("allows keyboard entry after Escape dismisses a hover-only preview", () => {
    const gate = previewDismissal()

    gate.dismiss("first", PreviewSource.Hover)
    expect(gate.allows("first", PreviewSource.Hover)).toBe(false)
    expect(gate.allows("first", PreviewSource.Focus)).toBe(true)
  })
})
