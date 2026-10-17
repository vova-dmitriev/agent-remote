import { cn } from "@/shared/lib/utils"
import type { TestAttributes } from "./types"

function Skeleton({ className, ...props }: React.ComponentProps<"div"> & TestAttributes) {
  return <div data-slot="skeleton" className={cn("bg-accent animate-pulse rounded-md", className)} {...props} />
}

export { Skeleton }
