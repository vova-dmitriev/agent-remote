export const ApplicationView = { Sessions: "sessions", Accounts: "accounts" } as const
export type ApplicationView = (typeof ApplicationView)[keyof typeof ApplicationView]
