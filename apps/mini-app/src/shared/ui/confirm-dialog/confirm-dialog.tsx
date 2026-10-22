import { Button } from "../button"
import { Modal } from "../modal"
import type { ConfirmDialogProps } from "./confirm-dialog.types"

/** Asks before an action that is hard to take back; cancelling is the default. */
export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel, onConfirm, onCancel, testIds }: ConfirmDialogProps) {
  return (
    <Modal open={open} title={title} onClose={onCancel} testId={testIds.root}>
      <p className="mt-[6px] text-[13px] leading-[19px] text-muted-foreground">{description}</p>
      <div className="mt-[18px] flex justify-end gap-[8px]">
        <Button type="button" variant="ghost" autoFocus data-testid={testIds.cancel} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" variant="destructive" data-testid={testIds.confirm} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
