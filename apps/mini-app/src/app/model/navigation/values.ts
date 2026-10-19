export const ApplicationView = { Sessions: "sessions", Accounts: "accounts", NewSession: "new-session" } as const
export type ApplicationView = (typeof ApplicationView)[keyof typeof ApplicationView]

export const DESKTOP_SIDEBAR_QUERY = "(min-width: 960px)"
