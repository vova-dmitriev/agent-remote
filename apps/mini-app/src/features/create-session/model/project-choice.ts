import { BindingState, IntegrationState, SessionStatus, type Session } from "@protocol"

/** Whether a new session can start beside this one: a live, verified session that may create sessions. */
const startsBeside = (session: Session) =>
  !!session.cwd &&
  session.capabilities.createSession &&
  session.binding === BindingState.Verified &&
  session.integrationState === IntegrationState.Ready &&
  session.status !== SessionStatus.Ended

/**
 * Where a new session can start: beside a session in its folder (one per folder), or in a project the device lists
 * that no session runs in yet (a shared VM's projects), where a new user's first session starts.
 */
export function projectChoice(sessions: Session[], projectPaths: readonly string[], projectId: string) {
  const seen = new Set<string>()

  const projects = sessions.filter((session) => {
    if (!startsBeside(session) || seen.has(session.cwd!)) return false
    seen.add(session.cwd!)

    return true
  })

  const paths = projectPaths.filter((path) => !seen.has(path))
  const selectedPath = paths.includes(projectId) ? projectId : projects.length ? undefined : paths[0]
  const selected = selectedPath ? undefined : (projects.find((session) => session.id === projectId) ?? projects[0])

  return {
    projects,
    selected,
    selectedPath,
    projectOptions: [
      ...projects.map((session) => ({ value: session.id, label: session.cwd ?? "" })),
      ...paths.map((path) => ({ value: path, label: path })),
    ],
    projectValue: selectedPath ?? selected?.id ?? "",
    projectLabel: selectedPath ?? selected?.cwd ?? "",
  }
}
