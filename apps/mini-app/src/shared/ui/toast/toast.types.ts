import type { ReactNode } from "react"

export interface ToastProps {
  /** A new value shows the toast again. */
  show: string
  children: ReactNode
  testId?: string
}

export interface ToastAnchorProps {
  className?: string
}
