import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { AgentName } from "@/entities/session"
import { MessageRole } from "@protocol"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import { MessageRail } from "./message-rail"

const meta = {
  component: MessageRail,
  decorators: [
    (Story) => (
      <div className="relative h-80">
        <Story />
      </div>
    ),
  ],
  args: {
    messages: Array.from({ length: 35 }, (_, index) => ({
      id: "synthetic-" + index,
      role: MessageRole.Assistant,
      text: "Example",
      occurredAt: index,
    })),
    agent: AgentName.Claude,
    activeId: "synthetic-3",
    jump: () => undefined,
  },
} satisfies Meta<typeof MessageRail>

export default meta
export const Navigation: StoryObj<typeof meta> = {}

export const JumpDismissesPreview: StoryObj<typeof meta> = {
  play: async ({ canvas }) => {
    const marker = canvas.getAllByTestId(SESSION_FEED_IDS.marker)[3]!

    await userEvent.hover(marker)
    await userEvent.click(marker)
  },
}
