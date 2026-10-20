import type { Meta, StoryObj } from "@storybook/react-vite"
import { ErrorCode, Language, ThemePreference } from "@protocol"
import { FileViewStatus } from "@/pages/session/config/file-view"
import { FileView } from "./file-view"

const notes = {
  path: "/synthetic/project/docs/NOTES.md",
  content:
    "# Synthetic notes\n\nA **formatted** design note.\n\n| Field | Value |\n| --- | --- |\n| model | synthetic |\n\n```ts\nexport const value = 2\n```",
  truncated: false,
}

const meta = {
  title: "Pages/Session/FileView",
  component: FileView,
  args: { path: notes.path, status: FileViewStatus.Ready, file: notes, onBack: () => {}, onRetry: () => {} },
} satisfies Meta<typeof FileView>

export default meta

type Story = StoryObj<typeof meta>

export const Markdown: Story = {}
export const Dark: Story = { globals: { theme: ThemePreference.Dark } }
export const English: Story = { globals: { language: Language.En } }
export const Code: Story = {
  args: { path: "src/value.ts", file: { path: "src/value.ts", content: "export const value: number = 2\n", truncated: false } },
}
export const Truncated: Story = { args: { file: { ...notes, truncated: true } } }
export const Loading: Story = { args: { status: FileViewStatus.Loading, file: undefined } }
export const Failed: Story = { args: { status: FileViewStatus.Failed, file: undefined, error: ErrorCode.CAPABILITY_UNAVAILABLE } }
