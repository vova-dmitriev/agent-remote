import type { Meta, StoryObj } from "@storybook/react-vite"
import { SessionTitle } from "./session-title"
import { RENAME_SESSION_IDS as IDS } from "../config/test-ids"

const meta = {
  title: "Features/RenameSession",
  component: SessionTitle,
  args: { title: "Synthetic session", disabled: false, controller: { save: async () => {}, busy: false } },
} satisfies Meta<typeof SessionTitle>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Editing: Story = {
  play: async ({ canvas }) => {
    await canvas.getByTestId(IDS.trigger).click()
  },
}
export const Offline: Story = { args: { disabled: true } }
