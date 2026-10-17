import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { SessionStatus, ConnectionStatus, ThemePreference, Language } from "@protocol"
import { SessionActionsStory } from "@storybook-components/actions/session-actions-story"
import { terminalSession } from "@storybook-fixtures/session"
import { COMMAND_IDS } from "@/features/send-command/config/test-ids"

const meta = { component: SessionActionsStory } satisfies Meta<typeof SessionActionsStory>

export default meta
type Story = StoryObj<typeof meta>
export const Closed: Story = {}
export const Open: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(COMMAND_IDS.actionsTrigger))
  },
}
export const Ended: Story = { ...Open, args: { session: { ...terminalSession, status: SessionStatus.Ended } } }
export const Busy: Story = { ...Open, args: { busy: true } }
export const Offline: Story = { ...Open, args: { connection: ConnectionStatus.Offline } }
export const Dark: Story = { ...Open, globals: { theme: ThemePreference.Dark } }
export const English: Story = { ...Open, globals: { language: Language.En } }
