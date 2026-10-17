import type { ComponentProps } from "react"
import { MARKDOWN_IDS } from "../test-ids"

export function CodePreview({ children }: ComponentProps<"pre">) {
  return (
    <pre data-testid={MARKDOWN_IDS.code} className="markdown-code-preview">
      {children}
    </pre>
  )
}
