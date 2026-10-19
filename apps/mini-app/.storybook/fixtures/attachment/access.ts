import { ErrorCode, HttpStatus, AttachmentKind, type AttachmentDescriptor } from "@protocol"
import type { AttachmentAccess } from "@/shared/api"
import { syntheticImageBytes } from "./media"

export const attachment: AttachmentDescriptor = {
  id: "synthetic-attachment",
  name: "synthetic-grid.png",
  mimeType: "image/png",
  byteLength: syntheticImageBytes().byteLength,
  sha256: "0".repeat(64),
  kind: AttachmentKind.Image,
}
export const attachmentUrl = "http://api.storybook.local/synthetic-attachments/"
export const attachmentAccess: AttachmentAccess = {
  upload: async () => attachment,
  download: async (_sessionId, id, signal) => {
    const response = await fetch(attachmentUrl + encodeURIComponent(id), { signal })

    if (!response.ok) throw new Error(response.status === HttpStatus.Gone ? ErrorCode.ATTACHMENT_EXPIRED : ErrorCode.NETWORK_UNAVAILABLE)

    return response.blob()
  },
}
