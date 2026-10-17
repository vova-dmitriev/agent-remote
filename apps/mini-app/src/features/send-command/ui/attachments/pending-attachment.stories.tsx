import type { Meta, StoryObj } from "@storybook/react-vite"
import { PendingAttachmentStatus } from "@/features/send-command/config/values"
import { ThemePreference, Language, ErrorCode } from "@protocol"
import { syntheticImageUrl } from "@storybook-fixtures/attachment/media"
import { PendingAttachmentChip } from "./pending-attachment"

const meta = {
  component: PendingAttachmentChip,
  args: {
    item: {
      id: "synthetic-upload",
      file: new File(["synthetic"], "synthetic.png", { type: "image/png" }),
      preview: syntheticImageUrl,
      progress: 48,
      status: PendingAttachmentStatus.Uploading,
    },
    disabled: false,
    remove: () => {},
    retry: () => {},
  },
} satisfies Meta<typeof PendingAttachmentChip>

export default meta
type Story = StoryObj<typeof meta>
export const Uploading: Story = {}
export const Ready: Story = { args: { item: { ...meta.args.item, status: PendingAttachmentStatus.Ready, progress: 100 } } }
export const Failed: Story = {
  args: { item: { ...meta.args.item, status: PendingAttachmentStatus.Error, error: ErrorCode.ATTACHMENT_QUOTA } },
}
export const Document: Story = {
  args: {
    item: {
      ...meta.args.item,
      file: new File(["synthetic"], "synthetic-document.json", { type: "application/json" }),
      preview: "",
      status: PendingAttachmentStatus.Ready,
      progress: 100,
    },
  },
}
export const Locked: Story = { args: { disabled: true }, globals: { theme: ThemePreference.Dark, language: Language.En } }
