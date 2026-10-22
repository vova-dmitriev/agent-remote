import type { Meta, StoryObj } from "@storybook/react-vite"
import { MessageRole } from "@protocol"
import { AgentName } from "@/entities/session"
import { ChatSearchResult } from "./chat-search-result"

const meta = {
  component: ChatSearchResult,
  args: {
    message: {
      id: "synthetic-match",
      role: MessageRole.Assistant,
      text: "…before the deploy, the synthetic Deploy check ran twice.",
      occurredAt: 1,
    },
    query: "deploy",
    agent: AgentName.Claude,
    onPick: () => undefined,
  },
} satisfies Meta<typeof ChatSearchResult>

export default meta
export const AgentMatch: StoryObj<typeof meta> = {}
export const OwnerMatch: StoryObj<typeof meta> = {
  args: { message: { id: "synthetic-own", role: MessageRole.User, text: "Deploy the synthetic build to the VM", occurredAt: 2 } },
}
