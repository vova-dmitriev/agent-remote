import type { ComponentProps } from "react"
import type { ExtraProps } from "react-markdown"
import { MarkdownNodeType } from "./constants/values"
import { MARKDOWN_IDS } from "./test-ids"

export function MarkdownLink({ children, href, title, node }: ComponentProps<"a"> & ExtraProps) {
  const containsImage = node?.children.some((child) => child.type === MarkdownNodeType.Element && child.tagName === "img")

  if (!href || containsImage) return <span data-testid={MARKDOWN_IDS.link}>{children}</span>

  return (
    <a data-testid={MARKDOWN_IDS.link} href={href} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}
