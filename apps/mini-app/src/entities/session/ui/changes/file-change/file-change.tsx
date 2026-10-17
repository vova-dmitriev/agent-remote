import { ChevronRight } from "lucide-react"
import ReactMarkdown, { type Options } from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import { useTranslation } from "@/shared/lib/hooks"
import { SESSION_CHANGES_IDS as IDS } from "@/entities/session/config/change-test-ids"
import { highlightDiffLines } from "@/entities/session/lib/changes/highlight-lines"
import { patchMarkdown, patchStats } from "@/entities/session/lib/changes/patch"
import type { FileChangeProps } from "./file-change.types"
import "../session-changes.css"

const plugins: Options["rehypePlugins"] = [[rehypeHighlight, { detect: false }], highlightDiffLines]
const kindKeys = { add: "changeAdded", delete: "changeDeleted", update: "changeUpdated" } as const

export function FileChange({ file }: FileChangeProps) {
  const { t } = useTranslation()
  const stats = patchStats(file.patch)

  return (
    <details className="session-change-file" data-testid={IDS.file} data-change-id={file.id}>
      <summary data-testid={IDS.fileToggle}>
        <ChevronRight className="session-change-chevron" size={12} aria-hidden="true" />
        <span className="session-change-path">{file.path}</span>
        <span className="session-change-kind">{t(kindKeys[file.kind])}</span>
        <span className="session-change-added">+{stats.added}</span>
        <span className="session-change-deleted">−{stats.deleted}</span>
      </summary>
      <div className="session-change-patch message-markdown" data-testid={IDS.patch}>
        <ReactMarkdown skipHtml rehypePlugins={plugins}>
          {patchMarkdown(file.path, file.patch)}
        </ReactMarkdown>
        {file.truncated ? (
          <p className="notice" data-testid={IDS.notice}>
            {t("changesLimited")}
          </p>
        ) : null}
      </div>
    </details>
  )
}
