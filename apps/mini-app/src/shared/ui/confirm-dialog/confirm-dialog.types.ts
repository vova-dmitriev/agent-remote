export interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  /** Also called by Escape. */
  onCancel: () => void
  testIds: { root: string; confirm: string; cancel: string }
}
