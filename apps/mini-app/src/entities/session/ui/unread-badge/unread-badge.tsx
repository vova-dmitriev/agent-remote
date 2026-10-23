import { MAX_UNREAD_MESSAGES } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { cn } from "@/shared/lib/utils"
import { SESSION_CARD_IDS } from "@/entities/session/config/test-ids"
import type { UnreadBadgeProps } from "./unread-badge.types"

/** A small count of unread replies: quiet in size, in the accent colour so a glance over the list finds it. */
export function UnreadBadge({ count, className }: UnreadBadgeProps) {
  const { t } = useTranslation()

  if (!count) return null
  const shown = count >= MAX_UNREAD_MESSAGES ? MAX_UNREAD_MESSAGES + "+" : String(count)

  return (
    <span
      data-testid={SESSION_CARD_IDS.unread}
      title={t("unreadReplies", { count: shown })}
      className={cn(
        "inline-flex h-[16px] min-w-[16px] shrink-0 items-center justify-center rounded-full bg-primary px-[5px] text-[10px] leading-none font-semibold text-primary-foreground tabular-nums",
        className,
      )}
    >
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{t("unreadReplies", { count: shown })}</span>
    </span>
  )
}
