import type { ReactNode } from "react"
import type { ExecutionProfileSummary, ProfileOperation } from "@protocol"

export interface ProfileCardProps {
  profile: ExecutionProfileSummary
  preferred: boolean
  operation?: ProfileOperation | undefined
  children?: ReactNode
}
