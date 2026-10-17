import type { ComponentProps } from "react"
import { useTranslation } from "@/shared/lib/hooks"
import { MARKDOWN_IDS } from "./test-ids"

export function MarkdownImageLink({ src, alt }: ComponentProps<"img">) {
  const { t } = useTranslation()
  const href = typeof src === "string" ? src : ""
  const label = t("markdownImageLink", { alt: alt || href })

  if (!href) return <span data-testid={MARKDOWN_IDS.imageLink}>{alt}</span>

  return (
    <a data-testid={MARKDOWN_IDS.imageLink} href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  )
}
