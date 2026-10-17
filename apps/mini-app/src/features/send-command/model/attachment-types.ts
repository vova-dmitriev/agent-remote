import type { AttachmentDescriptor } from "@protocol"
import { PendingAttachmentStatus } from "../config/values"

export interface PendingAttachment {
  id: string
  file: File
  preview: string
  progress: number
  status: PendingAttachmentStatus
  error?: string | undefined
  descriptor?: AttachmentDescriptor
}
