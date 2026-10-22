import { CommandActionType, MessageRole, type HistoryMessage } from "@protocol"
import { IN_FLIGHT_PROMPT_STATUSES, PROMPT_ECHO_PREFIX, PROMPT_ECHO_TTL_MS } from "./constants"
import type { PromptEcho, QueuedPrompt } from "./types"
import type { SessionStoreData } from "../types"

type EchoSource = Pick<SessionStoreData, "echoes" | "outbox">

const ownerIds = (messages: readonly HistoryMessage[]) =>
  messages.flatMap((message) => (message.role === MessageRole.User && !message.tool ? [message.id] : []))

/** The echoes the feed shows: in-flight or delivered prompts whose record has not arrived and that have not expired. */
function shown(data: EchoSource, sessionId: string, messages: readonly HistoryMessage[], now: number) {
  const owners = ownerIds(messages)

  return data.echoes.filter((echo) => {
    if (echo.sessionId !== sessionId || now - echo.sentAt > PROMPT_ECHO_TTL_MS) return false
    const item = data.outbox.find((entry) => entry.command.commandId === echo.commandId)

    if (item && !IN_FLIGHT_PROMPT_STATUSES.includes(item.status)) return false
    const known = new Set(echo.known)

    return owners.filter((id) => !known.has(id)).length <= echo.ahead
  })
}

/** Records a prompt that starts sending, so the feed shows it before the agent does. */
export function echoPrompt(data: EchoSource & Pick<SessionStoreData, "session">, item: QueuedPrompt, now = Date.now()): PromptEcho[] {
  const { command } = item
  const messages = data.session.messages[command.sessionId] ?? []

  if (command.action.type !== CommandActionType.Prompt || data.echoes.some((echo) => echo.commandId === command.commandId))
    return data.echoes

  const echo = {
    commandId: command.commandId,
    sessionId: command.sessionId,
    text: command.action.text,
    ...(command.action.attachments?.length ? { attachments: command.action.attachments } : {}),
    sentAt: now,
    known: ownerIds(messages),
    ahead: shown(data, command.sessionId, messages, now).length,
  }

  return [...data.echoes.filter((entry) => now - entry.sentAt <= PROMPT_ECHO_TTL_MS), echo]
}

/** The session's shown echoes as owner messages at the end of its feed. */
export function promptEchoes(data: EchoSource, sessionId: string, messages: readonly HistoryMessage[], now = Date.now()): HistoryMessage[] {
  return shown(data, sessionId, messages, now).map((echo) => ({
    id: PROMPT_ECHO_PREFIX + echo.commandId,
    role: MessageRole.User,
    text: echo.text,
    ...(echo.attachments ? { attachments: echo.attachments } : {}),
    occurredAt: echo.sentAt,
  }))
}
