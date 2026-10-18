import type { ExecutionProfileSummary, ProfileOperation, ProfileRequest, ProfileResponse } from "@protocol"

export interface ProfileActionsProps {
  profile: ExecutionProfileSummary
  operation?: ProfileOperation | undefined
  disabled: boolean
  preferred: boolean
  run: (request: ProfileRequest) => Promise<ProfileResponse | null>
}
