import { cn } from "@/shared/lib/utils"
import { SessionStatusTone } from "@/entities/session/config/session-values"
import { SESSION_CARD_IDS } from "@/entities/session/config/test-ids"
import { sessionStatusTone } from "@/entities/session/lib/status-tone"
import { statusToneClass } from "@/entities/session/ui/session-class"
import type { SessionStatusDotProps } from "./status-dot.types"

/** Session status mark: running pulses blue, waiting is amber, idle solid grey, unavailable a hollow ring. */
export function SessionStatusDot({ session, awaitingInput = false, className }: SessionStatusDotProps) {
  const tone = sessionStatusTone(session, awaitingInput)

  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      data-testid={SESSION_CARD_IDS.statusDot}
      className={cn("relative block size-[8px] shrink-0 rounded-full", statusToneClass[tone], className)}
    >
      {tone === SessionStatusTone.Running ? (
        <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-60 motion-reduce:animate-none" />
      ) : null}
    </span>
  )
}
