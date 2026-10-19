import { Check, Copy } from "lucide-react"
import type { ComponentProps } from "react"
import type { ExtraProps } from "react-markdown"
import { CopyStatus, useCopyCode, useTranslation } from "@/shared/lib/hooks"
import { MARKDOWN_IDS } from "./test-ids"
import { codeContent } from "./helpers/code-content"

export function CodeBlock({ children, node }: ComponentProps<"pre"> & ExtraProps) {
  const { t } = useTranslation()
  const { text, language } = codeContent(node)
  const { status, copy } = useCopyCode(text)

  const label = t(
    status === CopyStatus.Copied ? "markdownCodeCopied" : status === CopyStatus.Failed ? "markdownCopyCodeFailed" : "markdownCopyCode",
  )

  return (
    <div
      className="max-w-full overflow-hidden rounded-[var(--radius)] border border-border bg-code text-code-foreground"
      data-slot="code-block"
      data-testid={MARKDOWN_IDS.codeBlock}
      data-language={language}
    >
      <div className="flex items-center justify-between gap-4 bg-code-toolbar px-[0.65rem] py-[0.35rem] text-[0.75rem] text-muted-foreground">
        <span className="min-w-0 wrap-anywhere">{t("markdownCodeLanguage", { language: language || t("markdownPlainText") })}</span>
        <button
          type="button"
          data-testid={MARKDOWN_IDS.copyCode}
          className="inline-flex shrink-0 cursor-pointer items-center gap-[0.35rem] rounded-[0.25rem] px-[0.35rem] py-[0.25rem] hover:bg-inline-code hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          onClick={() => void copy()}
          aria-label={label}
        >
          {status === CopyStatus.Copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span data-testid={MARKDOWN_IDS.copyStatus} role="status">
            {label}
          </span>
        </button>
      </div>
      <pre
        className="m-0 overflow-x-auto p-[0.85rem] leading-[1.6] wrap-normal whitespace-pre [tab-size:2] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        data-testid={MARKDOWN_IDS.code}
        tabIndex={0}
      >
        {children}
      </pre>
    </div>
  )
}
