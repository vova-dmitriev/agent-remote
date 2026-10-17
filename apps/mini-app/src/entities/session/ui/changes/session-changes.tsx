import { ChevronDown, GitCompareArrows } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { SESSION_CHANGES_IDS as IDS } from "@/entities/session/config/change-test-ids"
import { FileChange } from "./file-change/file-change"
import type { SessionChangesProps } from "./session-changes.types"
import "./session-changes.css"

export function SessionChanges({ changes }: SessionChangesProps) {
  const { t } = useTranslation()

  return (
    <details className="session-changes" data-testid={IDS.root}>
      <summary data-testid={IDS.toggle}>
        <GitCompareArrows size={16} aria-hidden="true" />
        <span>{t("changes")}</span>
        <ChevronDown className="session-changes-chevron" size={14} aria-hidden="true" />
        {changes?.files.length ? <span className="session-changes-count">{changes.files.length}</span> : null}
      </summary>
      <div className="session-changes-content" data-testid={IDS.content}>
        <p className="source">{t(changes ? "changesRecorded" : "changesUnavailable")}</p>
        {changes && !changes.files.length && !changes.truncated ? <p data-testid={IDS.notice}>{t("changesEmpty")}</p> : null}
        {changes?.truncated ? (
          <p className="notice" data-testid={IDS.notice}>
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
