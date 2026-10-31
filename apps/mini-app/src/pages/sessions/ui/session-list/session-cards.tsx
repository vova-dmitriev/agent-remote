import { groupByProject, SessionCardSkeleton, useCollapsedProjects, useSessionsAwaitingInput } from "@/entities/session"
import { SESSIONS_PAGE_IDS } from "@/pages/sessions/config/test-ids"
import type { SessionsPageListProps } from "@/pages/sessions/ui/sessions-page.types"
import { ProjectGroup } from "./project-group"

export function SessionCards({ sessions, loading, searching, onSelect }: SessionsPageListProps) {
  const awaiting = useSessionsAwaitingInput()
  const { collapsed, toggle } = useCollapsedProjects()

  if (loading) {
    return (
      <div className="grid gap-0" data-testid={SESSIONS_PAGE_IDS.loading}>
        <SessionCardSkeleton />
        <SessionCardSkeleton />
        <SessionCardSkeleton />
      </div>
    )
  }

  return groupByProject(sessions).map((group) => (
    <ProjectGroup
      key={group.key}
      group={group}
      // A search shows its matches whatever is collapsed.
      open={searching || !collapsed.has(group.key)}
      awaiting={awaiting}
      onToggle={toggle}
      onSelect={onSelect}
    />
  ))
}
