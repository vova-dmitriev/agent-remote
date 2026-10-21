import type { Meta, StoryObj } from "@storybook/react-vite"
import { AnalyticsPeriod, Language, ThemePreference, UNKNOWN_USAGE_KEY, UsageProvider } from "@protocol"
import { UsageReportView } from "./usage-report"

const NOW = Date.now()
const tokens = (scale: number) => ({ input: 4_000 * scale, output: 21_000 * scale, cacheRead: 900_000 * scale, cacheWrite: 60_000 * scale })
const row = (key: string, label: string, scale: number, costUsd: number | null) => ({ key, label, tokens: tokens(scale), costUsd })

const day = (offset: number, scale: number) => ({
  day: new Date(NOW - offset * 86_400_000).toISOString().slice(0, 10),
  tokens: tokens(scale),
  costUsd: scale * 1.7,
})

const limit = (provider: UsageProvider, windowMinutes: number, usedPercent: number, hours: number) => ({
  provider,
  windowMinutes,
  usedPercent,
  resetsAt: NOW + hours * 3_600_000,
  observedAt: NOW - 60_000,
})

const report = {
  period: AnalyticsPeriod.Week,
  importing: null,
  totals: { tokens: tokens(31), costUsd: 52.4 },
  byModel: [
    row("claude-opus-5-5", "claude-opus-5-5", 20, 38.1),
    row("gpt-6.1-sol", "gpt-6.1-sol", 8, 11.3),
    row(UNKNOWN_USAGE_KEY, UNKNOWN_USAGE_KEY, 1, null),
  ],
  byProject: [row("/work/synthetic-app", "synthetic-app", 22, 40), row("/work/synthetic-docs", "synthetic-docs", 9, 12.4)],
  bySession: [
    { ...row("synthetic-session-1", "synthetic-app", 12, 19.9), provider: UsageProvider.Claude, lastAt: NOW },
    { ...row("synthetic-thread-2", "synthetic-docs", 5, 6.2), provider: UsageProvider.Codex, lastAt: NOW - 3_600_000 },
  ],
  daily: [6, 5, 4, 3, 2, 1, 0].map((offset) => day(offset, [3, 6, 2, 8, 5, 4, 3][offset]!)),
  rateLimits: [
    limit(UsageProvider.Claude, 300, 6, 4),
    limit(UsageProvider.Claude, 10_080, 74, 90),
    limit(UsageProvider.Codex, 300, 38, 2),
    limit(UsageProvider.Codex, 10_080, 12, 120),
  ],
}

const meta = { component: UsageReportView, args: { report, sessions: [] } } satisfies Meta<typeof UsageReportView>

export default meta
type Story = StoryObj<typeof meta>

export const Week: Story = {}
export const Importing: Story = { args: { report: { ...report, importing: { done: 40, total: 263 } } } }
export const NoLimits: Story = { args: { report: { ...report, rateLimits: [] } } }
export const Dark: Story = { globals: { theme: ThemePreference.Dark } }
export const English: Story = { globals: { language: Language.En } }
