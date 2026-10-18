import type { ReactNode } from "react"
import type { ProfileList } from "@protocol"

export interface AccountsViewProps {
  data?: ProfileList | undefined
  online: boolean
  loading: boolean
  error: string
  onBack: () => void
  onRefresh: () => void
  pending?: boolean
  busy?: boolean
  onRecover?: () => void
  children?: ReactNode
  creation?: ReactNode
}
