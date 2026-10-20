import { useTelegramBackButton } from "@/shared/lib/telegram"
import { sessionObserved } from "@/pages/session/lib/session-availability"
import { SUBAGENT_ACTIVE_STATUSES } from "@/pages/session/config/subagent"
import { useSubagentHistory } from "@/pages/session/model/subagent/use-subagent-history"
import { SubagentView } from "./subagent-view"
import type { SubagentPageProps } from "./subagent-page.types"

/** A subagent's read-only view: reads its own transcript window and polls it only while the subagent can still work. */
export function SubagentPage({ session, state, agentId, onBack }: SubagentPageProps) {
  const available = sessionObserved(state, session)
  const agent = session.subagents?.find((candidate) => candidate.id === agentId)
  const live = available && !!agent && SUBAGENT_ACTIVE_STATUSES.includes(agent.status)
  const history = useSubagentHistory({ sessionId: session.id, agentId, live, revision: agent?.updatedAt ?? -1 })

  useTelegramBackButton(onBack)

  return (
    <SubagentView
      session={session}
      agentId={agentId}
      available={available}
      messages={history.messages}
      status={history.status}
      error={history.error}
      onBack={onBack}
      onRetry={history.retry}
      onHistoryPage={history.page}
    />
  )
}
