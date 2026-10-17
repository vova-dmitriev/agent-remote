import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { ThemePreference, Language } from "@protocol"
import { SESSION_AVAILABILITY_IDS } from "@/entities/session/config/availability-test-ids"
import { SessionAvailability } from "./session-availability"

const meta = { component: SessionAvailability, args: { available: true } } satisfies Meta<typeof SessionAvailability>

export default meta
type Story = StoryObj<typeof meta>
export const Online: Story = {}
export const Offline: Story = { args: { available: false } }
export const Details: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(SESSION_AVAILABILITY_IDS.trigger))
  },
}
export const Dark: Story = { globals: { theme: ThemePreference.Dark } }
export const English: Story = { globals: { language: Language.En }, play: Details.play! }
