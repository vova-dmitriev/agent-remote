import { cn } from "@/shared/lib/utils"
import type { ToastAnchorProps } from "./toast.types"
import { TOAST_ANCHOR_ID } from "./toast.values"

/** The place a page offers for passing messages, over its own content. */
export function ToastAnchor({ className }: ToastAnchorProps) {
  return <div id={TOAST_ANCHOR_ID} className={cn("pointer-events-none absolute inset-x-0 z-20 flex justify-center", className)} />
}
