import type { Meta, StoryObj } from "@storybook/react-vite"
import { SessionStatus } from "@protocol"
import { terminalSession } from "@storybook-fixtures/session"
import { SESSION_CREATE_IDS } from "@/features/create-session/config/test-ids"
import { ResumeSession } from "./resume-session"

const ended = { ...terminalSession, status: SessionStatus.Ended, cwd: "/synthetic/project" }

const meta = {
  component: ResumeSession,
  args: { session: ended, online: true, onResume: (): Promise<unknown> => Promise.resolve() },
} satisfies Meta<typeof ResumeSession>

export default meta
export const Available: StoryObj<typeof meta> = {}
export const Offline: StoryObj<typeof meta> = { args: { online: false } }
export const Refused: StoryObj<typeof meta> = {
  args: { onResume: () => Promise.reject(new Error("INVALID_PROJECT")) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId(SESSION_CREATE_IDS.resumeSession))
  },
}
