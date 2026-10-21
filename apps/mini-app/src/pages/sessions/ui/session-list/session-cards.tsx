import { SessionCard, SessionCardSkeleton, useSessionsAwaitingInput } from "@/entities/session"
import { SESSIONS_PAGE_IDS } from "@/pages/sessions/config/test-ids"
import type { SessionsPageListProps } from "@/pages/sessions/ui/sessions-page.types"

export function SessionCards({ sessions, loading, onSelect }: SessionsPageListProps) {
  const awaiting = useSessionsAwaitingInput()

  if (loading) {
    return (
      <div className="grid gap-0" data-testid={SESSIONS_PAGE_IDS.loading}>
        <SessionCardSkeleton />
        <SessionCardSkeleton />
        <SessionCardSkeleton />
      </div>
    )
  }

  return sessions.map((session) => (
    <SessionCard key={session.id} session={session} awaitingInput={awaiting.has(session.id)} onSelect={onSelect} />
  ))
}
