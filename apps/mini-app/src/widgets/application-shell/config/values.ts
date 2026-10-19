export const ShellLayout = {
  Page: "page",
  Session: "session",
} as const

export type ShellLayout = (typeof ShellLayout)[keyof typeof ShellLayout]
