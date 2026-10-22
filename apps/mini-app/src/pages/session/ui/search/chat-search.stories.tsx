import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { AgentName } from "@/entities/session"
import { CHAT_SEARCH_IDS } from "@/pages/session/config/test-ids"
import { terminalSession } from "@storybook-fixtures/session"
import { ChatSearch } from "./chat-search"

const meta = {
  component: ChatSearch,
  args: { open: true, session: terminalSession, agent: AgentName.Claude, onPick: () => undefined, onClose: () => undefined },
} satisfies Meta<typeof ChatSearch>

export default meta
export const Empty: StoryObj<typeof meta> = {}
export const Typing: StoryObj<typeof meta> = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByTestId(CHAT_SEARCH_IDS.input), "deploy")
  },
}
