import type { Meta, StoryObj } from "@storybook/react-vite"
import { NativeRestartState } from "@protocol"
import { terminalSession } from "@storybook-fixtures/session"
import { NativeInputHelp } from "./native-input-help"

const meta = {
  component: NativeInputHelp,
  args: {
    session: { ...terminalSession, capabilities: { ...terminalSession.capabilities, prompt: false, restartSession: true } },
    disabled: false,
    onRestart: () => undefined,
  },
} satisfies Meta<typeof NativeInputHelp>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Pending: Story = { args: { disabled: true } }
export const Unavailable: Story = {
  args: { session: { ...terminalSession, capabilities: { ...terminalSession.capabilities, prompt: false } } },
}
export const Ambiguous: Story = {
  args: {
    session: {
      ...terminalSession,
      nativeRestartState: NativeRestartState.Ambiguous,
      capabilities: { ...terminalSession.capabilities, prompt: false, restartSession: false },
    },
  },
}
