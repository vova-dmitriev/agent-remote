import type { AttachmentDescriptor } from "@protocol"

export interface AttachmentAccess {
  download: (sessionId: string, attachmentId: string, signal: AbortSignal) => Promise<Blob>
  upload: (
    sessionId: string,
    generation: string,
    file: File,
    uploadId: string,
    signal: AbortSignal,
    progress: (value: number) => void,
  ) => Promise<AttachmentDescriptor>
}
