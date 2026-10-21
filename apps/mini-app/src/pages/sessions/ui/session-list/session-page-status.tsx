import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { SESSIONS_PAGE_IDS } from "@/pages/sessions/config/test-ids"
import type { SessionsPageListProps } from "@/pages/sessions/ui/sessions-page.types"

export function SessionPageStatus({ pagesLoading, pagesFailed, hasMore, sessions, onRetry }: SessionsPageListProps) {
  const { t } = useTranslation()

  return (
    <>
      {pagesLoading && (
        <p role="status" data-testid={SESSIONS_PAGE_IDS.pageLoading} className="p-3 text-center text-sm text-muted-foreground">
          {t("sessionPagesLoading")}
        </p>
      )}
      {pagesFailed && (
        <Button data-testid={SESSIONS_PAGE_IDS.pageRetry} variant="ghost" size="sm" className="mx-auto my-2" onClick={onRetry}>
          {t("sessionPagesRetry")}
        </Button>
      )}
      {hasMore && sessions.length > 0 && (
        <p data-testid={SESSIONS_PAGE_IDS.pageMore} className="p-2 text-center text-xs text-muted-foreground">
          {t("sessionPagesMore")}
        </p>
      )}
    </>
  )
}
