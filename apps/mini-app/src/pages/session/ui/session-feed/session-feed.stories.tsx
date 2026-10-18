import type { Meta, StoryObj } from "@storybook/react-vite"
import { messages, snapshot, terminalSession } from "@storybook-fixtures/session"
import { AgentName, SessionTab } from "@/entities/session"
import { HistoryStatus, Language, MessageRole } from "@protocol"
import { SessionFeed } from "./session-feed"

const meta = {
  component: SessionFeed,
  args: { sessionId: terminalSession.id, agent: AgentName.Claude, messages, tab: SessionTab.History, terminal: snapshot.terminal },
} satisfies Meta<typeof SessionFeed>

export default meta
export const History: StoryObj<typeof meta> = {}
export const Terminal: StoryObj<typeof meta> = { args: { tab: SessionTab.Terminal } }
export const Loading: StoryObj<typeof meta> = { args: { messages: [], historyStatus: HistoryStatus.Loading } }
export const ReloadingHistory: StoryObj<typeof meta> = { args: { historyStatus: HistoryStatus.Loading } }
export const Empty: StoryObj<typeof meta> = { args: { messages: [] } }
export const Disconnected: StoryObj<typeof meta> = { args: { messages: [], available: false }, globals: { language: Language.En } }
export const Codex: StoryObj<typeof meta> = { args: { agent: AgentName.Codex } }
export const LongConversation: StoryObj<typeof meta> = {
  args: {
    messages: Array.from({ length: 500 }, (_, index) => ({
      id: "message-" + index,
      role: index % 2 ? MessageRole.Assistant : MessageRole.User,
      occurredAt: index,
      text:
        index % 2
          ? "## A synthetic answer\n\n**Formatted** content with a list:\n\n- First item\n- Second item\n\n```typescript\nconst ready = true;\n```"
          : "Continue the example.",
    })),
  },
}
