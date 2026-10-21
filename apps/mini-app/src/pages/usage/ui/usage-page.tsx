import { ArrowLeft } from "lucide-react"
import { totalTokens } from "@/entities/usage"
import { feedbackText } from "@/shared/lib/i18n"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { Skeleton } from "@/shared/ui/skeleton"
import { cn } from "@/shared/lib/utils"
import { USAGE_PAGE_IDS } from "../config/test-ids"
import { USAGE_PERIODS } from "../config/values"
import { useUsageReport } from "../model/use-usage-report"
import { UsageReportView } from "./usage-report"
import type { UsagePageProps } from "./usage-page.types"

/** Tokens, API-equivalent cost and plan limits, counted on the device from its agents' transcripts. */
export function UsagePage({ deviceId, online, sessions, onBack }: UsagePageProps) {
  const { t } = useTranslation()
  const { period, setPeriod, query } = useUsageReport(deviceId, online)
  const report = query.data

  return (
    <section data-testid={USAGE_PAGE_IDS.root} className="mx-auto grid w-full max-w-3xl gap-[16px] py-[16px]">
      <div className="flex items-center gap-3">
        <Button data-testid={USAGE_PAGE_IDS.back} variant="ghost" size="icon" onClick={onBack} aria-label={t("accountsBack")}>
          <ArrowLeft />
        </Button>
        <h1 className="flex-1 text-[22px] tracking-[-0.5px]">{t("usageTitle")}</h1>
      </div>
      <div className="flex flex-wrap gap-[6px]" role="group" aria-label={t("usageTitle")}>
        {USAGE_PERIODS.map((item) => (
          <Button
            key={item.period}
            variant="outline"
            className={cn("h-[30px] rounded-full px-[12px] text-[12px]", item.period === period && "border-primary text-primary")}
            aria-pressed={item.period === period}
            data-testid={USAGE_PAGE_IDS.period}
            data-period={item.period}
            onClick={() => setPeriod(item.period)}
          >
            {t(item.label)}
          </Button>
        ))}
      </div>
      {query.isError ? (
        <div className="grid justify-items-start gap-[8px] text-[13px]" data-testid={USAGE_PAGE_IDS.failed}>
          <p>{feedbackText(query.error.message, t)}</p>
          <Button variant="outline" data-testid={USAGE_PAGE_IDS.retry} onClick={() => void query.refetch()}>
            {t("usageRetry")}
          </Button>
        </div>
      ) : null}
      {!report && !query.isError ? <Skeleton className="h-[160px] rounded-[12px]" /> : null}
      {report && !report.importing && !totalTokens(report.totals.tokens) ? (
        <p className="text-[13px] text-muted-foreground" data-testid={USAGE_PAGE_IDS.empty}>
          {t("usageEmpty")}
        </p>
      ) : null}
      {report ? <UsageReportView report={report} sessions={sessions} /> : null}
    </section>
  )
}
