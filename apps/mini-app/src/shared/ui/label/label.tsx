import type { ComponentProps } from "react"
import { cn } from "@/shared/lib/utils"
import type { TestAttributes } from "../types"

export function Label({ className, ...props }: ComponentProps<"label"> & TestAttributes) {
  return <label className={cn("text-sm font-medium", className)} {...props} />
}
