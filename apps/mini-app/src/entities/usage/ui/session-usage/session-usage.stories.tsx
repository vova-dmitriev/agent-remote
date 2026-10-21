import type { Meta, StoryObj } from "@storybook/react-vite"
import { Language } from "@protocol"
import { SessionUsage } from "./session-usage"

const tokens = { input: 52_000, output: 310_000, cacheRead: 11_400_000, cacheWrite: 820_000 }

const meta = {
  component: SessionUsage,
  args: { usage: { tokens, costUsd: 14.62, context: null } },
} satisfies Meta<typeof SessionUsage>

export default meta
type Story = StoryObj<typeof meta>

export const Priced: Story = {}
export const Unpriced: Story = { args: { usage: { tokens, costUsd: null, context: null } } }
export const English: Story = { globals: { language: Language.En } }
