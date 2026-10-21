import { describe, expect, it } from "vitest"
import { Language, TargetKind, UsageProvider, type RateLimit } from "@protocol"
import { LimitTone } from "../src/entities/usage/config/values"
import { limitTone, providerLimits, resetTime, usageProvider, windowLength } from "../src/entities/usage/lib/limits"

const limit = (provider: UsageProvider, windowMinutes: number): RateLimit => ({
  provider,
  windowMinutes,
  usedPercent: 1,
  resetsAt: 0,
  observedAt: 0,
})

describe("rate limits", () => {
  it("shows a session the windows of its own agent, five-hour first", () => {
    const limits = [limit(UsageProvider.Claude, 10_080), limit(UsageProvider.Codex, 300), limit(UsageProvider.Claude, 300)]

    expect(usageProvider(TargetKind.CodexDesktop)).toBe(UsageProvider.Codex)
    expect(usageProvider(TargetKind.ClaudeCodeCli)).toBe(UsageProvider.Claude)
    expect(providerLimits(limits, UsageProvider.Claude).map((value) => value.windowMinutes)).toEqual([300, 10_080])
  })

  it("names windows in hours or days and colours their use", () => {
    expect(windowLength(300)).toEqual({ short: "limitHours", long: "limitWindowHours", count: 5 })
    expect(windowLength(10_080)).toEqual({ short: "limitDays", long: "limitWindowDays", count: 7 })
    expect([69, 70, 89, 90].map(limitTone)).toEqual([LimitTone.Low, LimitTone.High, LimitTone.High, LimitTone.Exhausted])
  })

  it("shows a reset a moment before the hour at the hour", () => {
    const hour = new Date(2026, 9, 21, 14, 0).getTime()
    const format = new Intl.DateTimeFormat(Language.Ru, { hour: "2-digit", minute: "2-digit" })

    expect(resetTime(hour - 330, Language.Ru, hour - 3_600_000)).toBe(format.format(hour))
  })
})
