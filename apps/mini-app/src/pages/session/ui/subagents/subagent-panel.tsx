import { SubagentStatus } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { SUBAGENT_IDS } from "@/pages/session/config/test-ids"
import type { SubagentPanelProps } from "./subagent-panel.types"

const statusKeys = {
  queued: "subagentQueued",
  running: "statusRunning",
  waiting_input: "statusInput",
  completed: "subagentCompleted",
  failed: "subagentFailed",
  stopped: "subagentStopped",
  unknown: "statusUnknown",
} as const

export function SubagentPanel({ agents = [], online }: SubagentPanelProps) {
  const { t } = useTranslation()

  const active = agents.filter((agent) =>
    [SubagentStatus.Queued, SubagentStatus.Running, SubagentStatus.WaitingInput].some((candidateValue) => candidateValue === agent.status),
  ).length

  if (!agents.length) return null

  return (
    <details className="subagents" data-testid={SUBAGENT_IDS.root}>
      <summary data-testid={SUBAGENT_IDS.toggle}>
        {t("subagents")} · {t("subagentsCount", { active, total: agents.length })}
        {!online ? <span data-testid={SUBAGENT_IDS.offline}>{t("subagentsLastKnown")}</span> : null}
      </summary>
      <ul className="subagent-list" data-testid={SUBAGENT_IDS.list}>
        {agents.map((agent) => (
          <li key={agent.id} data-testid={SUBAGENT_IDS.row} data-agent-id={agent.id}>
            <div className="subagent-heading">
              <strong>{agent.name ?? agent.id}</strong>
              <span data-testid={SUBAGENT_IDS.status}>{t(statusKeys[agent.status])}</span>
            </div>
            {agent.task ? <p data-testid={SUBAGENT_IDS.task}>{agent.task}</p> : null}
            {agent.model ? <small>{agent.model}</small> : null}
          </li>
        ))}
      </ul>
    </details>
  )
}
