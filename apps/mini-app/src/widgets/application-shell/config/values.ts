export const ShellLayout = {
  Page: "page",
  Session: "session",
} as const

export type ShellLayout = (typeof ShellLayout)[keyof typeof ShellLayout]

/** The compact session layout: a full-height flex column within the safe area. */
export const SESSION_SHELL_CLASS =
  "m-auto flex h-[var(--tg-viewport-height,100dvh)] max-h-dvh min-h-0 w-full max-w-[980px] flex-col overflow-hidden px-[18px] pt-[calc(6px+env(safe-area-inset-top))] pb-[calc(8px+env(safe-area-inset-bottom))] phone:px-[10px]"
