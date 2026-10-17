import { PendingAttachmentStatus } from "../config/values"
import type { PendingAttachment } from "../model/attachment-types"

export function createPendingAttachment(file: File): PendingAttachment {
  return {
    id: crypto.randomUUID(),
    file,
    preview: "",
    progress: 0,
    status: PendingAttachmentStatus.Uploading,
  }
}
