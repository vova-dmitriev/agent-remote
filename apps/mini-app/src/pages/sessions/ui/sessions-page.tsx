import { useTranslation } from "@/shared/lib/hooks"
import { SessionCard, SessionCardSkeleton, useSessionsAwaitingInput } from "@/entities/session"
import { emptyStateTextClass } from "@/shared/ui/text"
import { ProviderFilter } from "./provider-filter/provider-filter"
import { useSessionFilter } from "../model/use-session-filter"
import { SESSIONS_PAGE_IDS } from "../config/test-ids"
import type { SessionsPageProps } from "./sessions-page.types"

export function SessionsPage({ sessions, connected, loading, onSelect, children, creation }: SessionsPageProps) {
  const { t } = useTranslation()
  const filter = useSessionFilter(sessions)
  const awaiting = useSessionsAwaitingInput()

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
      <div className="grid gap-0" data-testid={SESSIONS_PAGE_IDS.list} aria-busy={loading}>
        {loading ? (
          <div className="grid gap-0" data-testid={SESSIONS_PAGE_IDS.loading}>
            <SessionCardSkeleton />
            <SessionCardSkeleton />
            <SessionCardSkeleton />
          </div>
        ) : (
          filter.filtered.map((session) => (
            <SessionCard key={session.id} session={session} awaitingInput={awaiting.has(session.id)} onSelect={onSelect} />
          ))
        )}
        {connected && !loading && !sessions.length ? (
          <div className="p-[30px] text-center phone:px-0 phone:pt-[45px] phone:pb-[60px]" data-testid={SESSIONS_PAGE_IDS.empty}>
            <h2>{t("macConnected")}</h2>
            <p className={emptyStateTextClass}>{t("connectSession")}</p>
          </div>
        ) : null}
      </div>
      {!loading ? children : null}
    </section>
  )
}
