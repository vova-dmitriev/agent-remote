import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { terminalSession } from "@storybook-fixtures/session"
import { TERMINAL_INPUT_IDS } from "@/pages/session/config/test-ids"
import { TerminalInput } from "./terminal-input"

const meta = {
  component: TerminalInput,
  args: { session: { ...terminalSession, capabilities: { ...terminalSession.capabilities, terminalInput: true } } },
} satisfies Meta<typeof TerminalInput>

export default meta
export const Empty: StoryObj<typeof meta> = {}
export const Typing: StoryObj<typeof meta> = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByTestId(TERMINAL_INPUT_IDS.text), "git status")
  },
}
