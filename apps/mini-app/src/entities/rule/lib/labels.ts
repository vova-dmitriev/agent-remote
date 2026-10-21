import { ReadyRule, type RulesView } from "@protocol"
import type { Translate } from "@/shared/lib/i18n"
import { READY_RULE_LABELS, READY_RULE_PREFIX } from "../config/values"

/** A rule's name in the app's language: ready rules by their key, own rules as the owner named them. */
export function ruleLabel(rule: { id: string; name: string }, t: Translate) {
  const ready = Object.values(ReadyRule).find((value) => rule.id === READY_RULE_PREFIX + value)

  return ready ? t(READY_RULE_LABELS[ready]) : rule.name
}

/** Rules that can stop a session's commands: its own always, its project's unless it runs with bypass. */
export function sessionRulesCount(session: RulesView["session"]) {
  return session ? session.rules.length + (session.bypass ? 0 : session.fromProject.length) : 0
}
