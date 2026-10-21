import { useTranslation } from "@/shared/lib/hooks"
import { emptyStateTextClass } from "@/shared/ui/text"
import { SESSIONS_PAGE_IDS } from "@/pages/sessions/config/test-ids"
import type { SessionsPageListProps } from "@/pages/sessions/ui/sessions-page.types"

export function SessionListEmpty({ sessions, connected, loading, pagesLoading, pagesFailed, hasMore }: SessionsPageListProps) {
  const { t } = useTranslation()

  if (!connected || loading || pagesLoading || hasMore || pagesFailed || sessions.length) return null

  return (
    <div className="p-[30px] text-center phone:px-0 phone:pt-[45px] phone:pb-[60px]" data-testid={SESSIONS_PAGE_IDS.empty}>
      <h2>{t("macConnected")}</h2>
      <p className={emptyStateTextClass}>{t("connectSession")}</p>
    </div>
  )
}
