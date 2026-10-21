/** Settings pages that belong to the device rather than a session. */
export const DeviceView = { Accounts: "accounts", Usage: "usage", Rules: "rules" } as const
export type DeviceView = (typeof DeviceView)[keyof typeof DeviceView]

export const ApplicationView = { Sessions: "sessions", ...DeviceView, NewSession: "new-session" } as const
export type ApplicationView = (typeof ApplicationView)[keyof typeof ApplicationView]

export const DESKTOP_SIDEBAR_QUERY = "(min-width: 960px)"
