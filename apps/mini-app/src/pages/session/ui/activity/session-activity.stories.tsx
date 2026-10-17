import type { Meta, StoryObj } from "@storybook/react-vite"
import { SessionStatus, ActivityKind, ThemePreference } from "@protocol"
import { terminalSession as session } from "@storybook-fixtures/session"
import { SessionActivity } from "./session-activity"

const meta = {
  component: SessionActivity,
  args: {
    session: {
      ...session,
      status: SessionStatus.Running,
      currentActivity: { id: "synthetic-step", kind: ActivityKind.Command, startedAt: Date.now() },
    },
    available: true,
  },
} satisfies Meta<typeof SessionActivity>

export default meta
type Story = StoryObj<typeof meta>

export const Command: Story = {}
export const Searching: Story = {
  args: {
    session: { ...meta.args.session, currentActivity: { id: ActivityKind.Search, kind: ActivityKind.Search, startedAt: Date.now() } },
  },
}
export const Completed: Story = { args: { session: { ...session, status: SessionStatus.Idle } } }
export const Offline: Story = { args: { available: false } }
export const Dark: Story = { globals: { theme: ThemePreference.Dark } }
export const ReducedMotion: Story = { parameters: { reducedMotion: true } }
