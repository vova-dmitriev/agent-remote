import type { ComponentProps } from "react"
import { MARKDOWN_IDS } from "../test-ids"

export function ImagePreview({ alt }: ComponentProps<"img">) {
  return <span data-testid={MARKDOWN_IDS.imageLink}>{alt}</span>
}
