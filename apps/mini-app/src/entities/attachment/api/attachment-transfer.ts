import { ErrorCode, HttpStatus, attachmentSchema, type AttachmentDescriptor } from "@protocol"
import { fetchResponse, responseError, type AttachmentAccess } from "@/shared/api"

export class AttachmentTransfer implements AttachmentAccess {
  constructor(
    private credentials: () => { origin: string; token: string },
    private requests: Set<AbortController>,
  ) {}

  private path(sessionId: string) {
    return "/sessions/" + encodeURIComponent(sessionId) + "/attachments"
  }

  async download(sessionId: string, attachmentId: string, signal: AbortSignal) {
    const { origin, token } = this.credentials()
    const controller = new AbortController()
    const abort = () => controller.abort()

    this.requests.add(controller)
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) controller.abort()

    try {
      const response = await fetchResponse(origin + this.path(sessionId) + "/" + encodeURIComponent(attachmentId), {
        signal: controller.signal,
        headers: { authorization: `Bearer ${token}` },
      })

      if (!response.ok) throw await responseError(response)

      return await response.blob()
    } finally {
      signal.removeEventListener("abort", abort)
      this.requests.delete(controller)
    }
  }

  upload(sessionId: string, generation: string, file: File, uploadId: string, signal: AbortSignal, progress: (value: number) => void) {
    const { origin, token } = this.credentials()
    const controller = new AbortController()
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const cancel = () => controller.abort()

    this.requests.add(controller)
    signal.addEventListener("abort", cancel, { once: true })
    controller.signal.addEventListener("abort", abort, { once: true })

    return new Promise<AttachmentDescriptor>((resolve, reject) => {
      xhr.open("POST", origin + this.path(sessionId))
      xhr.timeout = 60000
      xhr.setRequestHeader("authorization", `Bearer ${token}`)
      xhr.setRequestHeader("content-type", file.type || "application/octet-stream")
      xhr.setRequestHeader("x-upload-id", uploadId)
      xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name))
      xhr.setRequestHeader("x-session-generation", generation)

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) progress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
      }

      xhr.onload = () => {
        try {
          const body: unknown = JSON.parse(xhr.responseText)

          if (xhr.status < HttpStatus.Ok || xhr.status >= HttpStatus.MultipleChoices) {
            const code = body && typeof body === "object" && "code" in body ? String(body.code) : ErrorCode.ATTACHMENT_UPLOAD_FAILED

            reject(new Error(code))
          } else resolve(attachmentSchema.parse(body))
        } catch {
          reject(new Error(ErrorCode.ATTACHMENT_UPLOAD_FAILED))
        }
      }

      xhr.onerror = () => reject(new Error(ErrorCode.NETWORK_UNAVAILABLE))
      xhr.ontimeout = () => reject(new Error(ErrorCode.REQUEST_TIMEOUT))
      xhr.onabort = () => reject(new Error(ErrorCode.ATTACHMENT_CANCELLED))
      if (signal.aborted) reject(new Error(ErrorCode.ATTACHMENT_CANCELLED))
      else xhr.send(file)
    }).finally(() => {
      signal.removeEventListener("abort", cancel)
      controller.signal.removeEventListener("abort", abort)
      this.requests.delete(controller)
    })
  }
}
