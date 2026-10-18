import type { ExecutionProfileSummary } from "@protocol"
import type { ProfileTaskExecutor } from "@/shared/api"

export interface ProfileEnrollmentProps {
  profile: ExecutionProfileSummary
  disabled: boolean
  perform: ProfileTaskExecutor
}
