import * as React from "react"
import { cn } from "@/shared/lib/utils"
import type { TestAttributes } from "../types"

function Textarea({ className, ...props }: React.ComponentProps<"textarea"> & TestAttributes) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 flex field-sizing-content min-h-16 w-full resize-y rounded-[9px] border bg-surface p-[13px] leading-[1.6] shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
