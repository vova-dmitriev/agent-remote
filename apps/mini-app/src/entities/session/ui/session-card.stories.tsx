import type { Meta, StoryObj } from "@storybook/react-vite"
import { SessionStatus } from "@protocol"
import { terminalSession, chatSession, codexCliSession, codexDesktopSession } from "@storybook-fixtures/session"
import { SessionCard } from "./session-card"

const meta = { component: SessionCard, args: { session: terminalSession, onSelect: () => {} }, tags: ["autodocs"] } satisfies Meta<
  typeof SessionCard
>

export default meta
type Story = StoryObj<typeof meta>
export const Idle: Story = {}
export const Named: Story = { args: { session: { ...terminalSession, title: "Synthetic sprint fixes" } } }
export const LongTitle: Story = {
  args: { session: { ...terminalSession, title: "Synthetic session with a long descriptive title that stays on one compact line" } },
}
export const Running: Story = { args: { session: { ...terminalSession, status: SessionStatus.Running } } }
export const Chat: Story = { args: { session: chatSession } }
export const Permission: Story = { args: { session: { ...terminalSession, status: SessionStatus.WaitingPermission } } }
export const CodexCli: Story = { args: { session: codexCliSession } }
export const CodexDesktop: Story = { args: { session: codexDesktopSession } }

export const UnknownModel: Story = { args: { session: { ...terminalSession, model: undefined } } }
export const LongModel: Story = {
  args: { session: { ...terminalSession, model: "synthetic-provider-model-with-a-long-version-and-deployment-name" } },
}
