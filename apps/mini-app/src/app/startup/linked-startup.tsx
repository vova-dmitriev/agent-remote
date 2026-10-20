import { SessionLoading } from "@/pages/session"
import { SessionFrame } from "@/widgets/application-shell"
import { STARTUP_IDS } from "../config/test-ids"

/** Startup for a session link: the compact session frame around the session's loading page. */
export function LinkedStartup() {
  return (
    <SessionFrame testId={STARTUP_IDS.root}>
      <SessionLoading />
    </SessionFrame>
  )
}
