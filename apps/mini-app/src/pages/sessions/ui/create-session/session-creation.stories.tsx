import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { ThemePreference } from "@protocol"
import { allSources } from "@storybook-fixtures/page-states"
import { SESSION_CREATE_IDS } from "@/pages/sessions/config/test-ids"
import { SessionCreation } from "./session-creation"

const meta = {
  component: SessionCreation,
  args: {
    sessions: allSources.map((session) => ({
      ...session,
      cwd: "/synthetic/project",
      capabilities: { ...session.capabilities, createSession: true },
    })),
    disabled: false,
    create: () => {},
  },
} satisfies Meta<typeof SessionCreation>

export default meta
type Story = StoryObj<typeof meta>

export const Collapsed: Story = {}
export const Open: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(SESSION_CREATE_IDS.toggle))
  },
}
export const Busy: Story = { ...Open, args: { disabled: true } }
export const Dark: Story = { ...Open, globals: { theme: ThemePreference.Dark } }

export const LongProjectPath: Story = {
  args: {
    sessions: allSources.map((session) => ({
      ...session,
      cwd: "/private/var/folders/" + "synthetic-long-directory-".repeat(10) + "/project",
      capabilities: { ...session.capabilities, createSession: true },
    })),
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(SESSION_CREATE_IDS.toggle))
    await userEvent.click(canvas.getByTestId(SESSION_CREATE_IDS.project.trigger))
  },
}
