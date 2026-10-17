import { useTranslation } from "@/shared/lib/hooks"
import { SessionCard, SessionCardSkeleton } from "@/entities/session"
import { ProviderFilter } from "./provider-filter/provider-filter"
import { useSessionFilter } from "../model/use-session-filter"
import { SESSIONS_PAGE_IDS } from "../config/test-ids"
import type { SessionsPageProps } from "./sessions-page.types"

export function SessionsPage({ sessions, connected, loading, onSelect, children, creation }: SessionsPageProps) {
  const { t } = useTranslation()
  const filter = useSessionFilter(sessions)

  return (
    <section data-testid={SESSIONS_PAGE_IDS.root}>
      <div className="intro">
        <div className="session-list-heading">
          <h1 data-testid={SESSIONS_PAGE_IDS.title}>{t("sessionsTitle")}</h1>
          {creation}
        </div>
      </div>
      {connected ? <ProviderFilter value={filter.provider} onChange={filter.setProvider} /> : null}
      <div className="sessions" data-testid={SESSIONS_PAGE_IDS.list} aria-busy={loading}>
        {loading ? (
          <div className="sessions" data-testid={SESSIONS_PAGE_IDS.loading}>
            <SessionCardSkeleton />
            <SessionCardSkeleton />
            <SessionCardSkeleton />
          </div>
        ) : (
          filter.filtered.map((session) => <SessionCard key={session.id} session={session} onSelect={onSelect} />)
        )}
        {connected && !loading && !sessions.length ? (
          <div className="empty compact" data-testid={SESSIONS_PAGE_IDS.empty}>
            <h2>{t("macConnected")}</h2>
            <p>{t("connectSession")}</p>
          </div>
        ) : null}
      </div>
      {!loading ? children : null}
    </section>
  )
}
