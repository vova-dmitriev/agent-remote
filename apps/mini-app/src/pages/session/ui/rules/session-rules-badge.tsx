import { ConnectionStatus, type Session } from "@protocol"
import { RulesBadge, sessionRulesCount, useRulesView } from "@/entities/rule"
import type { SessionState } from "@/entities/session"

interface SessionRulesBadgeProps {
  session: Session
  state: SessionState
  onOpen: (sessionId: string) => void
}

/** The session's 🛡: how many rules can stop its commands, read from its device; none, no badge. */
export function SessionRulesBadge({ session, state, onOpen }: SessionRulesBadgeProps) {
  const view = useRulesView(state.deviceId ?? "", session.id, !!state.deviceId && state.connection === ConnectionStatus.Online)

  const count = sessionRulesCount(view.data?.session ?? null)

  // Only a session some rule can stop shows it: the phone header has no room for an empty badge.
  return count ? <RulesBadge count={count} onOpen={() => onOpen(session.id)} /> : null
}
