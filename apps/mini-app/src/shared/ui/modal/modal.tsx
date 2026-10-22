import { useEffect, useRef } from "react"
import type { ModalProps } from "./modal.types"

/**
 * A modal over the page. The platform's modal `<dialog>` keeps focus inside and closes on Escape in every host
 * (Telegram, Chrome extension, desktop app).
 */
export function Modal({ open, title, onClose, testId, children }: ModalProps) {
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
      aria-labelledby={testId + "-title"}
      data-testid={testId}
      className="m-auto w-[min(360px,calc(100vw_-_32px))] rounded-[16px] border border-border bg-surface p-[18px] text-foreground shadow-[0_12px_36px_color-mix(in_srgb,var(--foreground)_18%,transparent)] backdrop:bg-background/70"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id={testId + "-title"} className="text-[16px] font-semibold">
        {title}
      </h2>
      {children}
    </dialog>
  )
}
