import { useEffect, useRef } from "react"
import { Button } from "../button"
import type { ConfirmDialogProps } from "./confirm-dialog.types"

/**
 * Asks before an action that is hard to take back. The platform's modal `<dialog>` keeps focus inside and closes
 * on Escape in every host (Telegram, Chrome extension, desktop app); cancelling is the default.
 */
export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel, onConfirm, onCancel, testIds }: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current

    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  return (
    <dialog
      ref={dialog}
      aria-labelledby={testIds.root + "-title"}
      data-testid={testIds.root}
      className="m-auto w-[min(360px,calc(100vw_-_32px))] rounded-[16px] border border-border bg-surface p-[18px] text-foreground shadow-[0_12px_36px_color-mix(in_srgb,var(--foreground)_18%,transparent)] backdrop:bg-background/70"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <h2 id={testIds.root + "-title"} className="text-[16px] font-semibold">
        {title}
      </h2>
      <p className="mt-[6px] text-[13px] leading-[19px] text-muted-foreground">{description}</p>
      <div className="mt-[18px] flex justify-end gap-[8px]">
        <Button type="button" variant="ghost" autoFocus data-testid={testIds.cancel} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" variant="destructive" data-testid={testIds.confirm} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
