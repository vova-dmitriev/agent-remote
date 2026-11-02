import type { ComponentProps } from "react"
import { AgentProvider, CommandActionType, ConnectionStatus, DeviceStatus, ErrorCode, type ModelChoice, type Session } from "@protocol"
import { AgentName, agentName } from "@/entities/session"
import type { SessionCreation } from "@/features/create-session"
import type { useApplication } from "./use-application"

type CreationProps = ComponentProps<typeof SessionCreation>

/** Starts a session through the device, in one of its projects, and opens it. */
async function startInProject(
  { state, commands, runtime }: ReturnType<typeof useApplication>,
  cwd: string,
  provider: AgentProvider,
  model?: ModelChoice,
  resume?: string,
) {
  const lease = runtime.current()

  if (!lease || !state.deviceId) throw new Error(ErrorCode.NO_AUTHENTICATED_CLIENT)

  const { sessionId } = await lease.client.createProjectSession(state.deviceId, {
    provider,
    cwd,
    ...(model ? { model } : {}),
    ...(resume ? { resume } : {}),
  })

  commands.openCreatedSession(sessionId)
}

/** Continues a dead session's conversation, by the agent's own id, in a new session in its folder. */
export function resumeSession(application: ReturnType<typeof useApplication>, session: Session, id: string) {
  const provider = agentName(session) === AgentName.Codex ? AgentProvider.Codex : AgentProvider.Claude

  return startInProject(application, session.cwd ?? "", provider, undefined, id)
}

/** Props for the create-session feature, shared by the session list and the desktop "New session" pane. */
export function sessionCreationProps(model: ReturnType<typeof useApplication>): CreationProps {
  const { state, commands } = model
  const online = state.connection === ConnectionStatus.Online && state.snapshot?.deviceStatus === DeviceStatus.Online

  return {
    sessions: state.snapshot?.sessions ?? [],
    online,
    disabled: !online || commands.busy || commands.awaitingReceipt || commands.uncertain,
    models: state.snapshot?.models ?? [],
    projects: state.snapshot?.projects ?? [],
    createInProject: (cwd, provider, choice, resume) => startInProject(model, cwd, provider, choice, resume),
    create: (session, provider, execution, model, resume) =>
      void commands.action(
        {
          type: CommandActionType.CreateSession,
          provider,
          cwd: session.cwd!,
          ...(execution ? { execution } : {}),
          ...(model ? { model } : {}),
          ...(resume ? { resume } : {}),
        },
        session,
      ),
  }
}
