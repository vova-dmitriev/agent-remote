import type { ClientCommand, CommandResult, HttpRequestMethod } from "@protocol"

export type CommandRequest = (method: HttpRequestMethod, path: string, body?: ClientCommand) => Promise<CommandResult>
