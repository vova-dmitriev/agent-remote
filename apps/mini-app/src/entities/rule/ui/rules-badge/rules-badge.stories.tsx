import type { Meta, StoryObj } from "@storybook/react-vite"
import { Language, ThemePreference } from "@protocol"
import { RulesBadge } from "./rules-badge"

const meta = { component: RulesBadge, args: { count: 3, onOpen: () => {} } } satisfies Meta<typeof RulesBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Three: Story = {}
export const None: Story = { args: { count: 0 } }
export const Dark: Story = { globals: { theme: ThemePreference.Dark } }
export const English: Story = { globals: { language: Language.En } }
