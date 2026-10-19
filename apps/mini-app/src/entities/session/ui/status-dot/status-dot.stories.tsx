import type { Meta, StoryObj } from "@storybook/react-vite"
import { IntegrationState, SessionStatus, ThemePreference } from "@protocol"
import { terminalSession } from "@storybook-fixtures/session"
import { SessionStatusDot } from "./status-dot"

const meta = {
  component: SessionStatusDot,
  title: "Entities/Session status dot",
  args: { session: terminalSession, className: "size-[12px]" },
} satisfies Meta<typeof SessionStatusDot>

export default meta
type Story = StoryObj<typeof meta>
export const Idle: Story = {}
export const Running: Story = { args: { session: { ...terminalSession, status: SessionStatus.Running } } }
export const WaitingPermission: Story = { args: { session: { ...terminalSession, status: SessionStatus.WaitingPermission } } }
export const WaitingInput: Story = { args: { session: { ...terminalSession, status: SessionStatus.WaitingInput } } }
export const Unavailable: Story = { args: { session: { ...terminalSession, integrationState: IntegrationState.Disconnected } } }
export const Ended: Story = { args: { session: { ...terminalSession, status: SessionStatus.Ended } } }
export const UnavailableDark: Story = { ...Unavailable, globals: { theme: ThemePreference.Dark } }
