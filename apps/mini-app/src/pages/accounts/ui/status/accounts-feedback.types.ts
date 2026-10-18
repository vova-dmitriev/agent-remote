import type { ProfileList } from "@protocol"

export interface AccountsFeedbackProps {
  data: ProfileList | undefined
  online: boolean
  error: string
  pending: boolean | undefined
  busy: boolean | undefined
  onRecover: (() => void) | undefined
}
