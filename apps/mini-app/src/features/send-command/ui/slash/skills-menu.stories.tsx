import type { Meta, StoryObj } from "@storybook/react-vite"
import { SkillsMenu } from "./skills-menu"

const meta = {
  component: SkillsMenu,
  globals: { language: "en" },
  decorators: [
    (Story) => (
      <div className="relative mt-[360px] w-full max-w-lg">
        <Story />
      </div>
    ),
  ],
  args: {
    listId: "synthetic-skills",
    active: 0,
    loading: false,
    failed: false,
    supported: true,
    truncated: false,
    items: [
      { name: "review", invocation: "/review", description: "Review the current changes" },
      { name: "test", invocation: "/project:test", description: "Run the project checks" },
    ],
    pick: () => undefined,
    highlight: () => undefined,
    retry: () => undefined,
  },
} satisfies Meta<typeof SkillsMenu>

export default meta
type Story = StoryObj<typeof meta>
export const Available: Story = {}
export const Loading: Story = { args: { loading: true, items: [] } }
export const Unavailable: Story = { args: { supported: false, items: [] } }
export const Failed: Story = { args: { failed: true, items: [] } }
export const Truncated: Story = { args: { truncated: true } }
