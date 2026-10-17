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
    <div className="markdown-code-block" data-testid={MARKDOWN_IDS.codeBlock} data-language={language}>
      <div className="markdown-code-toolbar">
        <span>{t("markdownCodeLanguage", { language: language || t("markdownPlainText") })}</span>
        <button
          type="button"
          data-testid={MARKDOWN_IDS.copyCode}
          className="markdown-copy-code"
          onClick={() => void copy()}
          aria-label={label}
        >
          {status === CopyStatus.Copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span data-testid={MARKDOWN_IDS.copyStatus} role="status">
            {label}
          </span>
        </button>
      </div>
      <pre data-testid={MARKDOWN_IDS.code} tabIndex={0}>
        {children}
      </pre>
    </div>
  )
}
