import { useTranslation } from "@/shared/lib/hooks"
import { useSessionPages } from "@/entities/session"
import { ProviderFilter } from "./provider-filter/provider-filter"
import { useSessionFilter } from "../model/use-session-filter"
import { SESSIONS_PAGE_IDS } from "../config/test-ids"
import { SessionsPageList } from "./session-list/session-list"
import type { SessionsPageProps } from "./sessions-page.types"

export function SessionsPage({ sessions, connected, loading, onSelect, onLoadPage, pageScope, children, creation }: SessionsPageProps) {
  const { t } = useTranslation()
  const filter = useSessionFilter(sessions)
  const pages = useSessionPages({ snapshot: sessions, scope: pageScope ?? null, provider: filter.provider, loadPage: onLoadPage })

  return (
    <section data-testid={SESSIONS_PAGE_IDS.root}>
      <div className="py-[10px]">
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <h1 className="text-[26px] tracking-[-0.8px]" data-testid={SESSIONS_PAGE_IDS.title}>
            {t("sessionsTitle")}
          </h1>
          {creation}
        </div>
      </div>
      {connected ? <ProviderFilter value={filter.provider} onChange={filter.setProvider} /> : null}
      <SessionsPageList
        sessions={pages.sessions}
        connected={connected}
        loading={loading}
        pagesLoading={pages.loading}
        pagesFailed={pages.failed}
        hasMore={pages.hasMore}
        onSelect={onSelect}
        onLoadMore={pages.loadMore}
        onRetry={pages.retry}
      />
      {!loading ? children : null}
    </section>
  )
}
