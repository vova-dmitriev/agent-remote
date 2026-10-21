import { useTranslation } from "@/shared/lib/hooks"
import { useState } from "react"
import { matchesSessionQuery, useSessionPages } from "@/entities/session"
import { mutedTextClass } from "@/shared/ui/text"
import { ProviderFilter } from "./provider-filter/provider-filter"
import { useSessionFilter } from "../model/use-session-filter"
import { SESSIONS_PAGE_IDS } from "../config/test-ids"
import { SessionsPageList } from "./session-list/session-list"
import { SessionSearch } from "./session-search"
import type { SessionsPageProps } from "./sessions-page.types"

export function SessionsPage({ sessions, connected, loading, onSelect, onLoadPage, pageScope, children, creation }: SessionsPageProps) {
  const { t } = useTranslation()
  const filter = useSessionFilter(sessions)
  const pages = useSessionPages({ snapshot: sessions, scope: pageScope ?? null, provider: filter.provider, loadPage: onLoadPage })
  const [query, setQuery] = useState("")
  // ponytail: searches the sessions loaded so far; older pages join the results as they load.
  const shown = query.trim() ? pages.sessions.filter((session) => matchesSessionQuery(session, query)) : pages.sessions

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
      {connected ? (
        // One row, so the search costs the list no height: the field takes what the agent filter leaves.
        <div className="flex items-start gap-[8px]">
          <SessionSearch query={query} onQuery={setQuery} />
          <ProviderFilter value={filter.provider} onChange={filter.setProvider} />
        </div>
      ) : null}
      {query.trim() && !shown.length ? (
        <p className={mutedTextClass + " px-[4px] py-[18px] text-center"} data-testid={SESSIONS_PAGE_IDS.noMatches}>
          {t("sidebarNoMatches", { query: query.trim() })}
        </p>
      ) : (
        <SessionsPageList
          sessions={shown}
          connected={connected}
          loading={loading}
          pagesLoading={pages.loading}
          pagesFailed={pages.failed}
          hasMore={pages.hasMore}
          onSelect={onSelect}
          onLoadMore={pages.loadMore}
          onRetry={pages.retry}
        />
      )}
      {!loading ? children : null}
    </section>
  )
}
