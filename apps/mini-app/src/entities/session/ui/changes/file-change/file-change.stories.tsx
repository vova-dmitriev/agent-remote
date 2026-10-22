import type { Meta, StoryObj } from "@storybook/react-vite"
import { FileChangeKind, ThemePreference } from "@protocol"
import { SESSION_CHANGES_IDS as IDS } from "@/entities/session/config/change-test-ids"
import { FileChange } from "./file-change"

const exampleFile = {
  id: "synthetic-edit:src/greeting.ts",
  path: "src/greeting.ts",
  kind: FileChangeKind.Update,
  patch:
    '@@ -1,2 +1,3 @@\n-export const greeting = "Before";\n+export const greeting: string = "Hello";\n+console.log(greeting);\n // Synthetic example',
  truncated: false,
  changedAt: Date.UTC(2026, 9, 22, 14, 5),
}

const meta = { title: "Entities/SessionChanges/File", component: FileChange, args: { file: exampleFile } } satisfies Meta<typeof FileChange>

export default meta

type Story = StoryObj<typeof meta>

export const Collapsed: Story = {}
export const Expanded: Story = {
  play: async ({ canvas }) => {
    await canvas.getByTestId(IDS.fileToggle).click()
  },
}
export const Dark: Story = { ...Expanded, globals: { theme: ThemePreference.Dark } }
export const LongPath: Story = {
  args: { file: { ...exampleFile, path: "src/features/very-long-synthetic-feature/ui/very-long-component-name.tsx" } },
}
export const Truncated: Story = { ...Expanded, args: { file: { ...exampleFile, truncated: true } } }
