import type { ExecutionLaunchSelection, ExecutionProfileSummary } from "@protocol"

export interface ProfileExecution {
  selection: ExecutionLaunchSelection
  expectedVersion: number
}

export interface ProfileLaunchResolution {
  profile: ExecutionProfileSummary | undefined
  profileAvailable: boolean
  execution: ProfileExecution | null
}
