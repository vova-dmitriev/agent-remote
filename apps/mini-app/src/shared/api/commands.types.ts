import type { ClientCommand, CommandResult } from "@protocol"

export type CommandRequest = (method: "POST" | "GET", path: string, body?: ClientCommand) => Promise<CommandResult>
