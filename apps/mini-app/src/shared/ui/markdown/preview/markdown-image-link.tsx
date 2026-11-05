import { useContext, type ComponentProps } from "react"
import { isLocalImagePath } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { LocalPathContext } from "../helpers/local-path-context"
import { MARKDOWN_IDS } from "../test-ids"

export function MarkdownImageLink({ src, alt }: ComponentProps<"img">) {
  const { t } = useTranslation()
  const openPath = useContext(LocalPathContext)
  const href = typeof src === "string" ? src : ""
  const label = t("markdownImageLink", { alt: alt || href })

  if (!href) return <span data-testid={MARKDOWN_IDS.imageLink}>{alt}</span>

  // A local image lives on the agent's device: the app opens it there.
  if (isLocalImagePath(href))
    return openPath ? (
      <button
        type="button"
        className="cursor-pointer text-left underline underline-offset-2"
        data-testid={MARKDOWN_IDS.localImage}
        onClick={() => openPath(href)}
      >
        {label}
      </button>
    ) : (
      <span data-testid={MARKDOWN_IDS.imageLink}>{label}</span>
    )

  return (
    <a data-testid={MARKDOWN_IDS.imageLink} href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  )
}
