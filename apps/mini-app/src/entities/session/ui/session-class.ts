import { SessionStatusTone } from "../config/session-values"

/**
 * `[&:hover]` instead of `hover:` keeps the pre-Tailwind sticky tap feedback on touch screens
 * (Tailwind's `hover:` only matches `(hover: hover)`); Tailwind emits it after the ghost variant's hover colour.
 */
export const sessionCardClass =
  "flex min-h-[72px] items-center gap-[10px] rounded-none border-0 bg-transparent px-[4px] py-[12px] text-left transition-[color] hover:bg-transparent dark:hover:bg-transparent [&:hover]:text-primary"

export const sessionCardBodyClass = "grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-[8px] gap-y-[4px]"

/** The single status → style map: running blue (pulses), waiting amber, idle solid grey, unavailable a hollow ring. */
export const statusToneClass = {
  [SessionStatusTone.Running]: "bg-primary",
  [SessionStatusTone.Attention]: "bg-warning",
  [SessionStatusTone.Idle]: "bg-status-muted",
  [SessionStatusTone.Unavailable]: "border-[1.5px] border-status-muted bg-card",
} as const satisfies Record<SessionStatusTone, string>

/** Session source line ("agent · model · source"); denser inside the compact session shell. */
export const sourceTextClass = "text-[11px] tracking-[0.4px] text-muted-foreground session:text-[10px] session:tracking-normal"
