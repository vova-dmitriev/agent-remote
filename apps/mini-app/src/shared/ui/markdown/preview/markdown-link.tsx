import { useContext, type ComponentProps } from "react"
import type { ExtraProps } from "react-markdown"
import { isLocalImagePath } from "@protocol"
import { MarkdownNodeType } from "../constants/values"
import { LocalPathContext } from "../helpers/local-path-context"
import { MARKDOWN_IDS } from "../test-ids"

export function MarkdownLink({ children, href, title, node }: ComponentProps<"a"> & ExtraProps) {
  const openPath = useContext(LocalPathContext)
  const containsImage = node?.children.some((child) => child.type === MarkdownNodeType.Element && child.tagName === "img")

  // A local image the agent named lives on its device: the app opens it there, a browser link would lead nowhere.
  if (href && isLocalImagePath(href) && !containsImage) {
    return openPath ? (
      <button
        type="button"
        className="cursor-pointer text-left underline underline-offset-2 [overflow-wrap:anywhere]"
        data-testid={MARKDOWN_IDS.localImage}
        onClick={() => openPath(href)}
      >
        {children}
      </button>
    ) : (
      <span data-testid={MARKDOWN_IDS.link}>{children}</span>
    )
  }

  if (!href || containsImage) return <span data-testid={MARKDOWN_IDS.link}>{children}</span>

  return (
    <a data-testid={MARKDOWN_IDS.link} href={href} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}
