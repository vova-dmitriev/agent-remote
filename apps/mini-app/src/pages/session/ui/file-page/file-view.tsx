import { ArrowLeft } from "lucide-react"
import { patchMarkdown } from "@/entities/session"
import { feedbackText } from "@/shared/lib/i18n"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { Markdown } from "@/shared/ui/markdown"
import { NoticeTone, noticeVariants } from "@/shared/ui/notice"
import { Skeleton } from "@/shared/ui/skeleton"
import { FILE_VIEW_IDS } from "@/pages/session/config/test-ids"
import { FileViewStatus, MARKDOWN_EXTENSIONS } from "@/pages/session/config/file-view"
import type { FileViewProps } from "./file-view.types"

const fileName = (path: string) => path.split("/").at(-1) ?? path
const isMarkdown = (path: string) => MARKDOWN_EXTENSIONS.includes(path.split(".").at(-1)?.toLowerCase() ?? "")

/** A file the session changed, as it is now on the Mac: Markdown formatted, anything else as highlighted text. */
export function FileView({ path, status, file, error, onBack, onRetry }: FileViewProps) {
  const { t } = useTranslation()

  return (
    <section className="session:flex session:min-h-0 session:flex-1 session:flex-col" data-testid={FILE_VIEW_IDS.root}>
      <div className="flex items-center gap-[8px] border-b border-border pt-[8px] pb-[6px] session:flex-none session:short:pt-[4px]">
        <Button
          variant="ghost"
          size="icon"
          className="size-[32px] flex-none p-0"
          data-testid={FILE_VIEW_IDS.back}
          aria-label={t("fileBack")}
          title={t("fileBack")}
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" size={20} />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[18px] session:text-[16px]">{fileName(path)}</h1>
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={path} data-testid={FILE_VIEW_IDS.path}>
            {path}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain py-[10px]" data-testid={FILE_VIEW_IDS.content}>
        {status === FileViewStatus.Loading ? (
          <div className="grid gap-[8px]" data-testid={FILE_VIEW_IDS.loading}>
            <Skeleton className="h-[20px] w-2/3" />
            <Skeleton className="h-[14px] w-full" />
            <Skeleton className="h-[14px] w-5/6" />
          </div>
        ) : null}
        {status === FileViewStatus.Failed ? (
          <div className={noticeVariants({ tone: NoticeTone.Error })} role="alert" data-testid={FILE_VIEW_IDS.error}>
            {feedbackText(error ?? "", t)}
            <Button variant="outline" size="sm" className="mt-[8px] block" data-testid={FILE_VIEW_IDS.retry} onClick={onRetry}>
              {t("fileRetry")}
            </Button>
          </div>
        ) : null}
        {status === FileViewStatus.Ready && file ? (
          <>
            {file.truncated ? (
              <p className={noticeVariants()} data-testid={FILE_VIEW_IDS.truncated}>
                {t("fileTruncated")}
              </p>
            ) : null}
            <Markdown text={isMarkdown(path) ? file.content : patchMarkdown(path, file.content)} />
          </>
        ) : null}
      </div>
    </section>
  )
}
