import type { ComponentProps } from "react"
import { MARKDOWN_IDS } from "../test-ids"

export function LinkPreview({ children }: ComponentProps<"a">) {
  return (
    <span data-testid={MARKDOWN_IDS.link} className="markdown-link-preview">
      {children}
    </span>
  )
}
