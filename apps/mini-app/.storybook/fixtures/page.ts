export const StoryPage = { SignIn: "sign-in", Sessions: "sessions", Session: "session" } as const

export type StoryPage = (typeof StoryPage)[keyof typeof StoryPage]
