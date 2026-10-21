import * as Popover from "@radix-ui/react-popover"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { RATE_LIMIT_IDS } from "@/entities/usage/config/test-ids"
import { limitTone, resetTime, roundPercent, windowLength } from "@/entities/usage/lib/limits"
import { useLimitClock } from "@/entities/usage/model/use-limit-clock"
import { LimitDetails } from "./limit-details"
import { toneTextClass } from "./tone-class"
import type { RateLimitsProps } from "./rate-limits.types"

/** The agent's plan windows in one line, "5h: 6% (14:00) 7d: 74% (Oct 25, 07:00)"; details on click. */
export function RateLimits({ limits, agent, now: fixed }: RateLimitsProps) {
  const { t, language } = useTranslation()
  const now = useLimitClock(fixed)

  if (!limits.length) return null

  return (
    <Popover.Root>
      <span className="inline-flex min-w-0 flex-none" data-testid={RATE_LIMIT_IDS.root}>
        <Popover.Trigger asChild>
          <Button
            variant="ghost"
            className="h-[28px] gap-[8px] px-[6px] text-[11px] font-normal whitespace-nowrap tabular-nums session:text-[10px]"
            data-testid={RATE_LIMIT_IDS.trigger}
            aria-label={t("rateLimits")}
          >
            {limits.map((limit) => {
              const length = windowLength(limit.windowMinutes)
              const percent = roundPercent(limit.usedPercent)

              return (
                <span key={limit.windowMinutes} data-testid={RATE_LIMIT_IDS.window} data-window-minutes={limit.windowMinutes}>
                  <span className="text-muted-foreground">{t(length.short, { count: length.count })}: </span>
                  <span className={toneTextClass[limitTone(percent)]}>{percent}%</span>
                  <span className="text-muted-foreground phone:hidden"> ({resetTime(limit.resetsAt, language, now)})</span>
                </span>
              )
            })}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="z-[70] w-[min(280px,calc(100vw_-_24px))] rounded-[10px] border border-border bg-surface px-[12px] py-[10px] text-[12px] leading-[1.4] text-foreground shadow-[0_6px_24px_color-mix(in_srgb,var(--foreground)_12%,transparent)]"
            data-testid={RATE_LIMIT_IDS.details}
            align="end"
            sideOffset={6}
            collisionPadding={12}
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <LimitDetails limits={limits} agent={agent} now={now} />
          </Popover.Content>
        </Popover.Portal>
      </span>
    </Popover.Root>
  )
}
