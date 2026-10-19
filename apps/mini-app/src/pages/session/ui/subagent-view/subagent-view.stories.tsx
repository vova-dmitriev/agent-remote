import type { Meta, StoryObj } from "@storybook/react-vite"
import { ErrorCode, IntegrationState, Language, ThemePreference } from "@protocol"
import { finishedSubagentId, runningSubagentId, subagentMessages, subagentSession } from "@storybook-fixtures/subagent"
import { SubagentHistoryStatus } from "@/pages/session/config/subagent"
import { SubagentView } from "./subagent-view"

const meta = {
  component: SubagentView,
  args: {
    session: subagentSession,
    agentId: runningSubagentId,
    available: true,
    messages: subagentMessages,
    status: SubagentHistoryStatus.Ready,
    error: "",
    onBack: () => {},
  },
} satisfies Meta<typeof SubagentView>

export default meta
type Story = StoryObj<typeof meta>

export const RunningWithToolCalls: Story = {}
export const RunningWithToolCallsEnglish: Story = { globals: { language: Language.En } }
export const Dark: Story = { globals: { theme: ThemePreference.Dark } }
export const Finished: Story = { args: { agentId: finishedSubagentId } }
export const Loading: Story = { args: { messages: [], status: SubagentHistoryStatus.Loading } }
export const TranscriptUnavailable: Story = {
  args: { messages: [], status: SubagentHistoryStatus.Unavailable, error: ErrorCode.TRANSCRIPT_UNAVAILABLE },
  globals: { language: Language.En },
}
export const ReadFailed: Story = { args: { messages: [], status: SubagentHistoryStatus.Failed, error: ErrorCode.SERVICE_UNAVAILABLE } }
export const Offline: Story = { args: { available: false } }
export const ObserveOnly: Story = {
  args: { session: { ...subagentSession, integrationState: IntegrationState.NeedsRestart } },
  globals: { language: Language.En },
}
