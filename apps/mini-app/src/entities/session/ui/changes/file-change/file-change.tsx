import { useMemo } from "react"
import { ChevronRight, FileText } from "lucide-react"
import { FileChangeKind } from "@protocol"
import { Button } from "@/shared/ui/button"
import ReactMarkdown, { type Options } from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import { useTranslation } from "@/shared/lib/hooks"
import { cn } from "@/shared/lib/utils"
import { noticeVariants } from "@/shared/ui/notice"
import { SESSION_CHANGES_IDS as IDS } from "@/entities/session/config/change-test-ids"
import { highlightDiffLines } from "@/entities/session/lib/changes/highlight-lines"
import { patchMarkdown, patchStats } from "@/entities/session/lib/changes/patch"
import { summaryClass } from "../summary-class"
import type { FileChangeProps } from "./file-change.types"
import { patchClass } from "./patch-class"

const plugins: Options["rehypePlugins"] = [[rehypeHighlight, { detect: false }], highlightDiffLines]
const kindKeys = { add: "changeAdded", delete: "changeDeleted", update: "changeUpdated" } as const

export function FileChange({ file, onOpen }: FileChangeProps) {
  const { t, language } = useTranslation()
  const stats = patchStats(file.patch)

  // The device's own time zone, as the rest of the app's times.
  const changedAt = useMemo(
    () =>
      file.changedAt
        ? new Intl.DateTimeFormat(language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(file.changedAt)
        : null,
    [file.changedAt, language],
  )

  return (
    <details className="group/file border-t border-border" data-testid={IDS.file} data-change-id={file.id}>
      <summary
        className={cn(summaryClass, "items-baseline gap-[0.45rem] px-[0.1rem] py-[0.65rem] text-[0.8rem]")}
        data-testid={IDS.fileToggle}
      >
        <ChevronRight className="flex-none text-muted-foreground group-open/file:rotate-90" size={12} aria-hidden="true" />
        <span className="min-w-0 flex-1 font-mono wrap-anywhere">{file.path}</span>
        <span className="text-[0.7rem] text-muted-foreground">{t(kindKeys[file.kind])}</span>
        {/* The time on top, the line counts under it, both on the right. */}
        <span className="flex flex-none flex-col items-end gap-[0.1rem] tabular-nums">
          {changedAt ? (
            <time
              className="text-[0.7rem] whitespace-nowrap text-muted-foreground"
              dateTime={new Date(file.changedAt!).toISOString()}
              data-testid={IDS.changedAt}
            >
              {changedAt}
            </time>
          ) : null}
          <span className="flex gap-[0.45rem]">
            <span className="text-syntax-string">+{stats.added}</span>
            <span className="text-danger">−{stats.deleted}</span>
          </span>
        </span>
      </summary>
      <div className={cn("message-markdown", patchClass)} data-testid={IDS.patch}>
        <ReactMarkdown skipHtml rehypePlugins={plugins}>
          {patchMarkdown(file.path, file.patch)}
        </ReactMarkdown>
        {file.truncated ? (
          <p className={cn(noticeVariants(), "mt-[0.75rem] mb-0 session:mb-0")} data-testid={IDS.notice}>
            {t("changesLimited")}
          </p>
        ) : null}
        {onOpen && file.kind !== FileChangeKind.Delete ? (
          <Button variant="outline" size="sm" className="mt-[0.75rem]" data-testid={IDS.open} onClick={() => onOpen(file.path)}>
            <FileText aria-hidden="true" size={14} />
            {t("openFile")}
          </Button>
        ) : null}
      </div>
    </details>
  )
}
