import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { ErrorCode, CommandActionType } from "@protocol"
import { PromptStatus } from "@/entities/session"
import { terminalSession } from "@storybook-fixtures/session"
import { COMMAND_IDS } from "@/features/send-command/config/test-ids"
import { PromptQueue } from "./prompt-queue"

const item = {
  command: {
    commandId: "synthetic-queued",
    sessionId: terminalSession.id,
    target: terminalSession.target,
    generation: terminalSession.generation,
    action: { type: CommandActionType.Prompt, text: "Check the synthetic changes after the current task." },
  },
  streamId: "synthetic",
  runtimeEpoch: 1,
  files: [],
  status: PromptStatus.Queued,
}

const queue = {
  items: [item],
  cancel: () => {},
  retry: () => {},
  check: () => {},
  beginEdit: () => true,
  saveEdit: () => true,
  cancelEdit: () => {},
  sendNow: () => {},
  canSendNow: () => true,
}

const meta = { component: PromptQueue, args: { queue } } satisfies Meta<typeof PromptQueue>

export default meta
type Story = StoryObj<typeof meta>
export const Waiting: Story = {}
export const Editing: Story = {
  args: { queue: { ...queue, items: [{ ...item, status: PromptStatus.Editing }] } },
  play: async ({ canvas }) => {
    await userEvent.clear(canvas.getByTestId(COMMAND_IDS.queuedEditorText))
    await userEvent.type(canvas.getByTestId(COMMAND_IDS.queuedEditorText), "Updated synthetic queued instruction.")
  },
}
export const EditValidationError: Story = {
  args: {
    queue: {
      ...queue,
      items: [{ ...item, status: PromptStatus.Editing }],
      saveEdit: () => {
        throw new Error(ErrorCode.INVALID_PROMPT)
      },
    },
  },
  play: async ({ canvas }) => {
    await userEvent.clear(canvas.getByTestId(COMMAND_IDS.queuedEditorText))
    await userEvent.click(canvas.getByTestId(COMMAND_IDS.saveQueuedEdit))
  },
}
export const SendNowUnavailable: Story = { args: { queue: { ...queue, canSendNow: () => false } } }
export const Accepted: Story = { args: { queue: { ...queue, items: [{ ...item, status: PromptStatus.Accepted }] } } }
export const Unconfirmed: Story = { args: { queue: { ...queue, items: [{ ...item, status: PromptStatus.Unknown }] } } }
export const Failed: Story = {
  args: { queue: { ...queue, items: [{ ...item, status: PromptStatus.Failed, code: ErrorCode.INVALID_PROMPT }] } },
}
