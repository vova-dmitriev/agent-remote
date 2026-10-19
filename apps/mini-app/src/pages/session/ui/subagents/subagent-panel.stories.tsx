import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { SubagentStatus, ThemePreference } from "@protocol"
import { SUBAGENT_IDS } from "@/pages/session/config/test-ids"
import { SubagentPanel } from "./subagent-panel"

const meta = {
  component: SubagentPanel,
  args: {
    online: true,
    agents: [
      {
        id: "reviewer",
        name: "Reviewer",
        task: "Review the session parser",
        model: "synthetic-model",
        status: SubagentStatus.Running,
        updatedAt: 1,
      },
      { id: "tests", name: "Tests", task: "Verify command ownership", status: SubagentStatus.Completed, updatedAt: 1 },
    ],
  },
} satisfies Meta<typeof SubagentPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Collapsed: Story = {}
export const Expanded: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(SUBAGENT_IDS.toggle))
  },
}
export const Offline: Story = { ...Expanded, args: { online: false } }
export const Empty: Story = { args: { agents: [] } }
export const Dark: Story = { ...Expanded, globals: { theme: ThemePreference.Dark } }
export const Clickable: Story = { ...Expanded, args: { onOpen: () => {} } }
