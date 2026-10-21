import { UsageProvider } from "@protocol"
import { AgentName } from "@/entities/session"
import { LimitDetails, formatCost, formatTokens, providerLimits, totalTokens, useLimitClock } from "@/entities/usage"
import { useTranslation } from "@/shared/lib/hooks"
import { USAGE_PAGE_IDS } from "../config/test-ids"
import { UsageSection } from "../config/values"
import { sessionRows } from "../lib/labels"
import { UsageDaily } from "./usage-daily"
import { UsageRows } from "./usage-rows"
import type { UsageReportViewProps } from "./usage-page.types"

const AGENTS = [
  { provider: UsageProvider.Claude, name: AgentName.Claude },
  { provider: UsageProvider.Codex, name: AgentName.Codex },
] as const

export function UsageReportView({ report, sessions }: UsageReportViewProps) {
  const { t, language } = useTranslation()
  const now = useLimitClock(undefined)
  const { tokens } = report.totals
  const cost = formatCost(report.totals.costUsd, language)

  const parts = [
    { label: t("usageInput"), value: tokens.input },
    { label: t("usageOutput"), value: tokens.output },
    { label: t("usageCacheRead"), value: tokens.cacheRead },
    { label: t("usageCacheWrite"), value: tokens.cacheWrite },
  ]

  return (
    <div className="grid gap-[20px]">
      {report.importing ? (
        <p className="text-[12px] text-muted-foreground" data-testid={USAGE_PAGE_IDS.importing}>
          {t("usageImporting", report.importing)}
        </p>
      ) : null}
      <section className="grid gap-[10px] rounded-[12px] border border-border p-[14px]" data-testid={USAGE_PAGE_IDS.totals}>
        <div className="flex items-baseline justify-between gap-[12px]">
          <strong className="text-[24px] tracking-[-0.5px] tabular-nums" data-testid={USAGE_PAGE_IDS.cost}>
            {cost ?? "—"}
          </strong>
          <span className="text-[12px] text-muted-foreground">{t("usageCost")}</span>
        </div>
        <p className="text-[13px] text-muted-foreground">
          {t("usageSessionLine", { tokens: formatTokens(totalTokens(tokens), language) })}
        </p>
        <dl className="grid grid-cols-2 gap-x-[16px] gap-y-[4px] text-[12px] phone:grid-cols-1">
          {parts.map((part) => (
            <div key={part.label} className="flex justify-between gap-[8px]">
              <dt className="text-muted-foreground">{part.label}</dt>
              <dd className="tabular-nums">{formatTokens(part.value, language)}</dd>
            </div>
          ))}
        </dl>
      </section>
      {report.rateLimits.length ? (
        <section className="grid gap-[14px] rounded-[12px] border border-border p-[14px] text-[12px]" data-testid={USAGE_PAGE_IDS.limits}>
          {AGENTS.map(({ provider, name }) => {
            const limits = providerLimits(report.rateLimits, provider)

            return limits.length ? <LimitDetails key={provider} limits={limits} agent={name} now={now} /> : null
          })}
        </section>
      ) : null}
      <UsageDaily days={report.daily} />
      <UsageRows section={UsageSection.Models} title="usageByModel" rows={report.byModel} />
      <UsageRows section={UsageSection.Projects} title="usageByProject" rows={report.byProject} />
      <UsageRows section={UsageSection.Sessions} title="usageBySession" rows={sessionRows(report.bySession, sessions)} />
    </div>
  )
}
