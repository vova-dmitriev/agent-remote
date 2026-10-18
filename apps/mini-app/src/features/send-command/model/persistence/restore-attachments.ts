import { ErrorCode, MAX_MESSAGE_ATTACHMENT_BYTES, type AttachmentDescriptor } from "@protocol"
import type { AttachmentAccess } from "@/shared/api"
import { PendingAttachmentStatus } from "@/features/send-command/config/values"
import type { PendingAttachment } from "../attachment-types"

export async function restoreAttachments(
  access: AttachmentAccess,
  sessionId: string,
  descriptors: AttachmentDescriptor[],
  signal: AbortSignal,
) {
  if (descriptors.reduce((total, item) => total + item.byteLength, 0) > MAX_MESSAGE_ATTACHMENT_BYTES)
    throw new Error(ErrorCode.ATTACHMENTS_TOO_LARGE)

  return Promise.all(
    descriptors.map(async (descriptor): Promise<PendingAttachment> => {
      try {
        const blob = await access.download(sessionId, descriptor.id, signal)

        if (signal.aborted) throw new Error(ErrorCode.ATTACHMENT_CANCELLED)
        if (blob.size !== descriptor.byteLength) throw new Error(ErrorCode.ATTACHMENT_INTEGRITY_FAILED)

        return {
          id: descriptor.id,
          descriptor,
          file: new File([blob], descriptor.name, { type: descriptor.mimeType }),
          preview: "",
          progress: 100,
          status: PendingAttachmentStatus.Ready,
        }
      } catch (error) {
        if (signal.aborted) throw error

        return {
          id: descriptor.id,
          reference: descriptor,
          file: new File([], descriptor.name, { type: descriptor.mimeType }),
          preview: "",
          progress: 0,
          status: PendingAttachmentStatus.Error,
          error: error instanceof Error ? error.message : ErrorCode.ATTACHMENT_TRANSFER_FAILED,
        }
      }
    }),
  )
}
