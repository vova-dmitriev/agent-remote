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
    <details className="flex-[0_0_auto] border-b border-border text-[0.75rem]" data-testid={SUBAGENT_IDS.root}>
      <summary className="cursor-pointer py-[0.4rem] text-muted-foreground" data-testid={SUBAGENT_IDS.toggle}>
        {t("subagents")} · {t("subagentsCount", { active, total: agents.length })}
        {!online ? (
          <span className="ml-[0.5rem]" data-testid={SUBAGENT_IDS.offline}>
            {t("subagentsLastKnown")}
          </span>
        ) : null}
      </summary>
      <ul className="m-0 max-h-[9rem] list-none overflow-auto p-0" data-testid={SUBAGENT_IDS.list}>
        {agents.map((agent) => (
          <li className="py-[0.4rem]" key={agent.id} data-testid={SUBAGENT_IDS.row} data-agent-id={agent.id}>
            <div className="flex items-baseline justify-between gap-[0.5rem]">
              <strong className="overflow-hidden text-ellipsis whitespace-nowrap">{agent.name ?? agent.id}</strong>
              <span className="text-muted-foreground" data-testid={SUBAGENT_IDS.status}>
                {t(statusKeys[agent.status])}
              </span>
            </div>
            {agent.task ? (
              <p className="my-[0.2rem] whitespace-pre-wrap wrap-anywhere" data-testid={SUBAGENT_IDS.task}>
                {agent.task}
              </p>
            ) : null}
            {agent.model ? <small className="text-muted-foreground">{agent.model}</small> : null}
          </li>
        ))}
      </ul>
    </details>
  )
}
