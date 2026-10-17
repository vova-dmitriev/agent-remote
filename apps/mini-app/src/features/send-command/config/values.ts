export const ControlStatus = {
  Sending: "sending",
  Accepted: "accepted",
  Unknown: "unknown",
} as const

export type ControlStatus = (typeof ControlStatus)[keyof typeof ControlStatus]

export const PendingAttachmentStatus = {
  Uploading: "uploading",
  Ready: "ready",
  Error: "error",
} as const

export type PendingAttachmentStatus = (typeof PendingAttachmentStatus)[keyof typeof PendingAttachmentStatus]

export const PromptDeliveryMode = {
  Immediate: "immediate",
  Send: "send",
  Retry: "retry",
  Check: "check",
} as const

export type PromptDeliveryMode = (typeof PromptDeliveryMode)[keyof typeof PromptDeliveryMode]
