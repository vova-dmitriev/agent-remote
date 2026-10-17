import type { CommandController } from "@/features/send-command/model/use-command"
import type { PendingAttachment } from "@/features/send-command/model/attachment-types"

export interface AttachmentPickerProps {
  model: CommandController["attachments"]
  disabled: boolean
}

export interface PendingAttachmentChipProps {
  item: PendingAttachment
  disabled: boolean
  remove: () => void
  retry: () => void
}
