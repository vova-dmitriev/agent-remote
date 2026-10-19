import type { ComponentProps } from "react"
import { MARKDOWN_IDS } from "../test-ids"

export function CodePreview({ children }: ComponentProps<"pre">) {
  return (
    <pre
      data-testid={MARKDOWN_IDS.code}
      className="max-w-full overflow-hidden rounded-[6px] bg-code px-[10px] py-[8px] whitespace-pre-wrap text-code-foreground wrap-anywhere"
    >
      {children}
    </pre>
  )
}
