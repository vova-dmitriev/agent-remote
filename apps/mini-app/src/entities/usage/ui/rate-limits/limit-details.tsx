import { useTranslation } from "@/shared/lib/hooks"
import { cn } from "@/shared/lib/utils"
import { RATE_LIMIT_IDS } from "@/entities/usage/config/test-ids"
import { LIMIT_STALE_MS } from "@/entities/usage/config/values"
import { limitTone, relativeTime, resetTime, roundPercent, windowLength } from "@/entities/usage/lib/limits"
import { toneBarClass } from "./tone-class"
import type { LimitDetailsProps } from "./rate-limits.types"

export function LimitDetails({ limits, agent, now }: LimitDetailsProps) {
  const { t, language } = useTranslation()
  const observedAt = Math.max(...limits.map((limit) => limit.observedAt))

  return (
    <div className="flex flex-col gap-[10px]">
      <strong className="text-[13px] font-semibold">{t("rateLimitsOf", { agent })}</strong>
      {limits.map((limit) => {
        const length = windowLength(limit.windowMinutes)
        const percent = roundPercent(limit.usedPercent)

        return (
          <div
            key={limit.windowMinutes}
            className="flex flex-col gap-[4px]"
            data-testid={RATE_LIMIT_IDS.detail}
            data-window-minutes={limit.windowMinutes}
          >
            <div className="flex items-baseline justify-between gap-[12px]">
              <span>{t(length.long, { count: length.count })}</span>
              <span className="text-muted-foreground">{t("limitUsed", { percent })}</span>
            </div>
            <div className="h-[4px] overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className={cn("h-full rounded-full", toneBarClass[limitTone(percent)])} style={{ width: `${percent}%` }} />
            </div>
            <span className="text-[11px] text-muted-foreground">
              {t("limitResets", {
                time: `${resetTime(limit.resetsAt, language, now)} · ${relativeTime(limit.resetsAt, language, now)}`,
              })}
            </span>
          </div>
        )
      })}
      <span className="text-[11px] text-muted-foreground">{t("limitUpdated", { time: relativeTime(observedAt, language, now) })}</span>
      {now - observedAt > LIMIT_STALE_MS ? (
        <span className="text-[11px] text-warning" data-testid={RATE_LIMIT_IDS.stale}>
          {t("limitStale")}
        </span>
      ) : null}
    </div>
  )
}
