import type { Meta, StoryObj } from "@storybook/react-vite"
import { ThemePreference } from "@protocol"
import { UnreadBadge } from "./unread-badge"

const meta = {
  component: UnreadBadge,
  title: "Entities/Unread badge",
  args: { count: 3 },
} satisfies Meta<typeof UnreadBadge>

export default meta
type Story = StoryObj<typeof meta>
export const Few: Story = {}
export const Many: Story = { args: { count: 99 } }
export const Dark: Story = { globals: { theme: ThemePreference.Dark } }
