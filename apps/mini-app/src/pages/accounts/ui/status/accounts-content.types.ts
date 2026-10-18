import type { ReactNode } from "react"
import type { ProfileList } from "@protocol"

export interface AccountsContentProps {
  data: ProfileList | undefined
  online: boolean
  loading: boolean
  children: ReactNode
}
