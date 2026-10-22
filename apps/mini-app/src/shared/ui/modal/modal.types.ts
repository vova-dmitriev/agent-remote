import type { ReactNode } from "react"

export interface ModalProps {
  open: boolean
  title: string
  /** Also called by Escape. */
  onClose: () => void
  testId: string
  children: ReactNode
}
