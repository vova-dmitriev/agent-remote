export const CopyStatus = {
  Idle: "idle",
  Copied: "copied",
  Failed: "failed",
} as const

export type CopyStatus = (typeof CopyStatus)[keyof typeof CopyStatus]
