import type { Meta, StoryObj } from "@storybook/react-vite"
import { AgentName } from "@/entities/session"
import { ColorScheme, MessageRole } from "@protocol"
import { MessagePreview } from "./message-preview"

const meta = {
  component: MessagePreview,
  args: {
    id: "synthetic-preview",
    agent: AgentName.Claude,
    message: {
      id: "preview-example",
      role: MessageRole.Assistant,
      text: "A short synthetic answer with the next useful step and enough context to recognize this message.",
      occurredAt: 1700000000000,
    },
    anchor: document.body,
    keep: () => undefined,
    leave: () => undefined,
  },
} satisfies Meta<typeof MessagePreview>

export default meta
export const Assistant: StoryObj<typeof meta> = {}
export const User: StoryObj<typeof meta> = { args: { message: { ...meta.args.message, role: MessageRole.User } } }

export const RichMarkdown: StoryObj<typeof meta> = {
  args: {
    message: {
      ...meta.args.message,
      text: "**Release ready**\n\n- Tests passed\n- Review complete\n\n```ts\nconst answer = 42;\n```\n\n[Review](https://example.test/pr/1)",
    },
  },
}
export const RichMarkdownDark: StoryObj<typeof meta> = { ...RichMarkdown, globals: { theme: ColorScheme.Dark } }
export const PastedContent: StoryObj<typeof meta> = {
  args: {
    message: {
      ...meta.args.message,
      role: MessageRole.User,
      text: '<pasted_content id="synthetic">\n**PR ready**\n\n[Review](https://example.test/pr/1)\n</pasted_content>',
    },
  },
}
export const TaskNotification: StoryObj<typeof meta> = {
  args: {
    message: {
      ...meta.args.message,
      role: MessageRole.User,
      text: "<task-notification><task-id>synthetic-task</task-id><tool-use-id>synthetic-tool</tool-use-id><status>completed</status><summary>**Review complete**</summary><result>- No blockers\n- Tests passed</result></task-notification>",
    },
  },
}
