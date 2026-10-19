import { SessionStatus } from "@protocol"

export const sessionCardClass =
  "flex min-h-[72px] items-center gap-[10px] rounded-none border-0 bg-transparent px-[4px] py-[12px] text-left transition-[color] hover:bg-transparent hover:text-primary dark:hover:bg-transparent [&:hover]:text-primary"

export const sessionCardBodyClass = "grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-[8px] gap-y-[4px]"

export const statusDotClass: Record<SessionStatus, string> = {
  [SessionStatus.Unknown]: "bg-status-muted",
  [SessionStatus.Idle]: "bg-status-ready",
  [SessionStatus.Running]: "bg-status-busy",
  [SessionStatus.WaitingPermission]: "bg-primary",
  [SessionStatus.WaitingInput]: "bg-status-muted",
  [SessionStatus.Ended]: "bg-status-muted",
}
