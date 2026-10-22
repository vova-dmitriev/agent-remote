import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/shared/lib/utils"
import type { ToastProps } from "./toast.types"
import { TOAST_ANCHOR_ID, TOAST_DURATION_MS } from "./toast.values"

/**
 * Shows its content once each time `show` changes to a new value, over the page's toast anchor (or the window's bottom
 * without one), and hides it after a moment.
 */
export function Toast({ show, children, testId }: ToastProps) {
  const [shown, setShown] = useState<{ key: string; anchor: HTMLElement | null } | null>(null)

  useEffect(() => {
    if (!show) return
    const timer = window.setTimeout(() => setShown(null), TOAST_DURATION_MS)

    setShown({ key: show, anchor: document.getElementById(TOAST_ANCHOR_ID) })

    return () => window.clearTimeout(timer)
  }, [show])

  if (!shown || shown.key !== show) return null

  const toast = (
    <p className={cn(toastClass, !shown.anchor && "fixed bottom-[24px] left-1/2 z-20 -translate-x-1/2")} role="status" data-testid={testId}>
      {children}
    </p>
  )

  return shown.anchor ? createPortal(toast, shown.anchor) : toast
}

const toastClass =
  "rounded-full border border-border bg-surface px-[12px] py-[6px] text-[12px] text-foreground shadow-[0_3px_12px_color-mix(in_srgb,var(--foreground)_15%,transparent)]"
