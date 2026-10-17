import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { BindingState, IntegrationState } from "@protocol"
import { ComposerStory } from "@storybook-components/composer-story"
import { terminalSession, chatSession } from "@storybook-fixtures/session"
import { COMMAND_IDS } from "@/features/send-command"

const meta = { component: ComposerStory, args: { session: terminalSession } } satisfies Meta<typeof ComposerStory>

export default meta
type Story = StoryObj<typeof meta>
export const Ready: Story = {}
export const Draft: Story = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByTestId(COMMAND_IDS.prompt), "Synthetic draft")
  },
}
export const ReadOnly: Story = { args: { session: { ...chatSession, capabilities: { ...chatSession.capabilities, prompt: false } } } }

export const NativeObservation: Story = {
  args: {
    session: {
      ...terminalSession,
      binding: BindingState.Unverified,
      integrationState: IntegrationState.NeedsRestart,
      capabilities: { ...terminalSession.capabilities, prompt: false, interrupt: false },
    },
  },
}

export const MultilineDraft: Story = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByTestId(COMMAND_IDS.prompt), "First line{enter}Second line{enter}Third line{enter}Fourth line")
  },
}
