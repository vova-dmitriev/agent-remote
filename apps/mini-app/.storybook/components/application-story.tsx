import type { ComponentProps } from "react"
import { StoryPage } from "@storybook-fixtures/page"
import { ConnectionStatus } from "@protocol"
import { ApplicationShell } from "@/widgets/application-shell"
import { SignInPage } from "@/pages/sign-in"
import { CommandNotice } from "@/features/send-command"
import { SessionPageStory } from "./session-page-story"
import { SessionsPageStory } from "./sessions-page-story"
import { sessionState } from "../fixtures/page-states"

export function ApplicationStory({
  page = StoryPage.Sessions,
  connection = ConnectionStatus.Online,
  result = "",
  error = "",
  busy = false,
  sessionProps = {},
  sessionsProps = {},
}: {
  page?: StoryPage
  connection?: ComponentProps<typeof ApplicationShell>["connection"]
  result?: string
  error?: string
  busy?: boolean
  sessionProps?: ComponentProps<typeof SessionPageStory>
  sessionsProps?: ComponentProps<typeof SessionsPageStory>
}) {
  return (
    <ApplicationShell compact={page === StoryPage.Session} connection={connection} result={result} onHome={() => {}} onLogout={() => {}}>
      <CommandNotice error={error} busy={busy} retry={() => {}} />
      {page === StoryPage.SignIn ? (
        <SignInPage />
      ) : page === StoryPage.Session ? (
        <SessionPageStory state={sessionState({ connection })} busy={busy} {...sessionProps} />
      ) : (
        <SessionsPageStory online={connection === ConnectionStatus.Online} {...sessionsProps} />
      )}
    </ApplicationShell>
  )
}
