import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { Language, ThemePreference, UsageProvider } from "@protocol"
import { RATE_LIMIT_IDS } from "@/entities/usage/config/test-ids"
import { RateLimits } from "./rate-limits"

const NOW = Date.parse("2026-10-21T10:00:00Z")
const HOUR = 3_600_000

const window = (windowMinutes: number, usedPercent: number, resetsIn: number, observedAgo = 60_000) => ({
  provider: UsageProvider.Claude,
  windowMinutes,
  usedPercent,
  resetsAt: NOW + resetsIn,
  observedAt: NOW - observedAgo,
})

const meta = {
  component: RateLimits,
  args: { agent: "Claude", now: NOW, limits: [window(300, 6, 4 * HOUR), window(10_080, 74, 90 * HOUR)] },
} satisfies Meta<typeof RateLimits>

export default meta
type Story = StoryObj<typeof meta>

const open: Story["play"] = async ({ canvas }) => {
  await userEvent.click(canvas.getByTestId(RATE_LIMIT_IDS.trigger))
}

export const Closed: Story = {}
export const Open: Story = { play: open }
export const NearlyExhausted: Story = {
  args: { limits: [window(300, 93, 30 * 60_000), window(10_080, 81, 20 * HOUR)] },
  play: open,
}
export const Stale: Story = {
  args: { limits: [window(300, 40, 2 * HOUR, 3 * HOUR), window(10_080, 50, 50 * HOUR, 3 * HOUR)] },
  play: open,
}
export const Empty: Story = { args: { limits: [] } }
export const DarkOpen: Story = { ...Open, globals: { theme: ThemePreference.Dark } }
export const EnglishOpen: Story = { ...Open, globals: { language: Language.En } }
