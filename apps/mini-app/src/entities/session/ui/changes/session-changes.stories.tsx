import type { Meta, StoryObj } from "@storybook/react-vite"
import { FileChangeKind, ThemePreference, Language } from "@protocol"
import { SESSION_CHANGES_IDS as IDS } from "@/entities/session/config/change-test-ids"
import { SessionChanges } from "./session-changes"

const file = {
  id: "synthetic-edit:src/greeting.ts",
  path: "src/greeting.ts",
  kind: FileChangeKind.Update,
  patch: "@@ -1 +1 @@\n-export const value = 1;\n+export const value: number = 2;",
  truncated: false,
}

const meta = {
  title: "Entities/SessionChanges",
  component: SessionChanges,
  args: { changes: { files: [file], truncated: false } },
} satisfies Meta<typeof SessionChanges>

export default meta

type Story = StoryObj<typeof meta>

export const Collapsed: Story = {}
export const Expanded: Story = {
  play: async ({ canvas }) => {
    await canvas.getByTestId(IDS.toggle).click()
    await canvas.getByTestId(IDS.fileToggle).click()
  },
}
export const Dark: Story = { ...Expanded, globals: { theme: ThemePreference.Dark } }
export const English: Story = { ...Expanded, globals: { language: Language.En } }
export const Empty: Story = {
  args: { changes: { files: [], truncated: false } },
  play: async ({ canvas }) => {
    await canvas.getByTestId(IDS.toggle).click()
  },
}
export const Unavailable: Story = { ...Empty, args: { changes: undefined } }
export const Limited: Story = { ...Expanded, args: { changes: { files: [file], truncated: true } } }
