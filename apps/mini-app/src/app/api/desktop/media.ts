import { z } from "zod"
import {
  ErrorCode,
  LOCAL_LIMITS,
  LocalOperation,
  MAX_ATTACHMENT_BYTES,
  attachmentSchema,
  desktopMediaChunkDataSchema,
  type AttachmentDescriptor,
} from "@protocol"
import type { AttachmentAccess } from "@/shared/api"
import type { DesktopBridgeConnection } from "./desktop-connection.js"

const transferSchema = z.strictObject({ transferId: z.string().min(1) })
const offsetSchema = z.strictObject({ offset: z.number().int().nonnegative() })
const readSchema = transferSchema.extend({ descriptor: attachmentSchema })
const chunkSchema = z.strictObject({ data: desktopMediaChunkDataSchema, done: z.boolean() })

const encodeBase64 = (bytes: Uint8Array) => {
  let binary = ""

  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary)
}

const decodeBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0))

export class DesktopMedia implements AttachmentAccess {
  private active = new Set<AbortController>()
  private stopped = false

  constructor(private readonly connection: DesktopBridgeConnection) {}

  private track(signal: AbortSignal) {
    if (this.stopped || signal.aborted) throw new Error(ErrorCode.ATTACHMENT_CANCELLED)
    if (this.active.size >= LOCAL_LIMITS.maxTransfers) throw new Error(ErrorCode.UPLOAD_BUSY)

    const controller = new AbortController()
    const abort = () => controller.abort()

    signal.addEventListener("abort", abort, { once: true })
    this.active.add(controller)

    return {
      signal: controller.signal,
      cleanup: () => {
        signal.removeEventListener("abort", abort)
        this.active.delete(controller)
      },
    }
  }

  private abort(transferId: string) {
    void this.connection.request({ operation: LocalOperation.MediaAbort, transferId }).catch(() => {})
  }

  private async uploadChunks(
    transferId: string,
    file: File,
    signal: AbortSignal,
    progress: (value: number) => void,
    offset: number,
  ): Promise<void> {
    if (offset >= file.size) return
    if (signal.aborted) throw new Error(ErrorCode.ATTACHMENT_CANCELLED)

    const bytes = new Uint8Array(await file.slice(offset, offset + LOCAL_LIMITS.chunkBytes).arrayBuffer())

    if (signal.aborted) throw new Error(ErrorCode.ATTACHMENT_CANCELLED)
    const data = encodeBase64(bytes)

    if (signal.aborted) throw new Error(ErrorCode.ATTACHMENT_CANCELLED)

    const acknowledged = offsetSchema.parse(
      await this.connection.request({ operation: LocalOperation.MediaChunk, transferId, offset, data }),
    )

    if (acknowledged.offset !== offset + bytes.length) throw new Error(ErrorCode.ATTACHMENT_TRANSFER_FAILED)

    progress(Math.min(99, Math.round((acknowledged.offset / file.size) * 100)))
    await this.uploadChunks(transferId, file, signal, progress, acknowledged.offset)
  }

  async upload(
    sessionId: string,
    generation: string,
    file: File,
    uploadId: string,
    signal: AbortSignal,
    progress: (value: number) => void,
  ): Promise<AttachmentDescriptor> {
    if (!file.size || file.size > MAX_ATTACHMENT_BYTES) throw new Error(ErrorCode.ATTACHMENT_TOO_LARGE)

    const tracked = this.track(signal)
    let transferId: string | undefined
    let complete = false

    try {
      const begun = transferSchema.parse(
        await this.connection.request({
          operation: LocalOperation.MediaBegin,
          sessionId,
          generation,
          uploadId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          byteLength: file.size,
        }),
      )

      transferId = begun.transferId

      await this.uploadChunks(transferId, file, tracked.signal, progress, 0)

      const descriptor = attachmentSchema.parse(await this.connection.request({ operation: LocalOperation.MediaFinish, transferId }))

      complete = true
      progress(100)

      return descriptor
    } finally {
      if (transferId && !complete) this.abort(transferId)
      tracked.cleanup()
    }
  }

  async download(sessionId: string, attachmentId: string, signal: AbortSignal): Promise<Blob> {
    const tracked = this.track(signal)
    let transferId: string | undefined

    try {
      const begun = readSchema.parse(await this.connection.request({ operation: LocalOperation.MediaRead, sessionId, attachmentId }))

      const chunks: BlobPart[] = []
      let offset = 0

      transferId = begun.transferId

      while (offset < begun.descriptor.byteLength) {
        if (tracked.signal.aborted) throw new Error(ErrorCode.ATTACHMENT_CANCELLED)

        const chunk = chunkSchema.parse(await this.connection.request({ operation: LocalOperation.MediaReadChunk, transferId, offset }))

        const bytes = decodeBase64(chunk.data)

        if (!bytes.length || bytes.length > LOCAL_LIMITS.chunkBytes || offset + bytes.length > begun.descriptor.byteLength) {
          throw new Error(ErrorCode.ATTACHMENT_TRANSFER_FAILED)
        }

        chunks.push(new Uint8Array(bytes))
        offset += bytes.length

        if (chunk.done !== (offset === begun.descriptor.byteLength)) throw new Error(ErrorCode.ATTACHMENT_TRANSFER_FAILED)
      }

      const blob = new Blob(chunks, { type: begun.descriptor.mimeType })
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))
      const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")

      if (hash !== begun.descriptor.sha256) throw new Error(ErrorCode.ATTACHMENT_INTEGRITY_FAILED)

      return blob
    } finally {
      if (transferId) this.abort(transferId)
      tracked.cleanup()
    }
  }

  close(): void {
    this.stopped = true

    for (const controller of this.active) controller.abort()
  }
}
