import { ChevronDown, GitCompareArrows } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { cn } from "@/shared/lib/utils"
import { noticeVariants } from "@/shared/ui/notice"
import { SESSION_CHANGES_IDS as IDS } from "@/entities/session/config/change-test-ids"
import { sourceTextClass } from "../session-class"
import { FileChange } from "./file-change/file-change"
import { summaryClass } from "./summary-class"
import type { SessionChangesProps } from "./session-changes.types"

export function SessionChanges({ changes }: SessionChangesProps) {
  const { t } = useTranslation()

  return (
    <details
      className="group/changes mt-1 mb-2 min-w-0 flex-[0_0_auto] rounded-[var(--radius)] border border-border bg-surface"
      data-testid={IDS.root}
    >
      <summary className={cn(summaryClass, "items-center gap-2 px-[0.8rem] py-[0.65rem] font-semibold")} data-testid={IDS.toggle}>
        <GitCompareArrows size={16} aria-hidden="true" />
        <span>{t("changes")}</span>
        <ChevronDown className="flex-none text-muted-foreground group-open/changes:rotate-180" size={14} aria-hidden="true" />
        {changes?.files.length ? <span className="ml-auto text-muted-foreground tabular-nums">{changes.files.length}</span> : null}
      </summary>
      <div className="max-h-[min(48dvh,32rem)] overflow-auto overscroll-contain px-[0.65rem] pb-[0.65rem]" data-testid={IDS.content}>
        <p className={sourceTextClass}>{t(changes ? "changesRecorded" : "changesUnavailable")}</p>
        {changes && !changes.files.length && !changes.truncated ? <p data-testid={IDS.notice}>{t("changesEmpty")}</p> : null}
        {changes?.truncated ? (
          <p className={noticeVariants()} data-testid={IDS.notice}>
            {t("changesLimited")}
          </p>
        ) : null}
        {changes?.files.map((file) => (
          <FileChange key={file.id} file={file} />
        ))}
      </div>
    </details>
  )
}
