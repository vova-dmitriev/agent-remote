import { CommandActionType, CommandStatus, ErrorCode, HttpStatus, type ClientCommand, type CommandResult } from "@protocol"
import { COMMAND_PENDING_LIMIT, COMMAND_RECEIPT_LIMIT } from "./command-constants"
import type { CommandRequest } from "./commands.types"

const intent = ({ commandId: _, ...command }: ClientCommand) => JSON.stringify(command)

const lane = (command: ClientCommand) =>
  command.action.type === CommandActionType.Prompt
    ? JSON.stringify([command.target.deviceId, command.sessionId, command.generation])
    : command.commandId

export class CommandSubmission {
  private pending = new Map<string, ClientCommand>()
  private active = new Set<string>()
  private receipts = new Map<string, CommandResult>()
  constructor(private request: CommandRequest) {}
  observe(result: CommandResult): CommandResult {
    const previous = this.receipts.get(result.commandId)

    if (
      previous &&
      ([CommandStatus.Dispatched, CommandStatus.Rejected].some((candidateValue) => candidateValue === previous.status) ||
        (previous.status === CommandStatus.Unknown && result.status === CommandStatus.Accepted))
    )
      return previous
    if ([CommandStatus.Dispatched, CommandStatus.Rejected].some((candidateValue) => candidateValue === result.status))
      this.pending.delete(result.commandId)
    this.receipts.set(result.commandId, result)

    if (this.receipts.size > COMMAND_RECEIPT_LIMIT) {
      const oldest = [...this.receipts.keys()].find((id) => !this.pending.has(id))

      if (oldest) this.receipts.delete(oldest)
    }

    return result
  }
  private complete(result: CommandResult) {
    const observed = this.observe(result)

    return observed
  }
  private knownResult(commandId: string) {
    const result = this.receipts.get(commandId)

    return result && result.status !== CommandStatus.Accepted ? this.complete(result) : undefined
  }
  retryPending(commandId?: string) {
    if (!commandId && this.pending.size > 1) return Promise.reject(new Error(ErrorCode.PENDING_COMMAND_ID_REQUIRED))
    const command = commandId ? this.pending.get(commandId) : this.pending.values().next().value

    return command ? this.send(command) : Promise.reject(new Error(ErrorCode.NO_PENDING_COMMAND))
  }
  async checkPending(commandId: string): Promise<CommandResult> {
    const known = this.knownResult(commandId)

    if (known && [CommandStatus.Dispatched, CommandStatus.Rejected].some((candidateValue) => candidateValue === known.status)) return known

    try {
      return this.complete(await this.request("GET", "/commands/" + encodeURIComponent(commandId)))
    } catch {
      const latest = this.knownResult(commandId)

      if (latest) return latest
      throw new Error(ErrorCode.COMMAND_STATUS_UNKNOWN)
    }
  }
  async send(command: ClientCommand): Promise<CommandResult> {
    const existing = this.pending.get(command.commandId)

    if (existing && intent(existing) !== intent(command)) throw new Error(ErrorCode.COMMAND_PENDING_STATUS)
    const known = this.receipts.get(command.commandId)

    if (known && [CommandStatus.Dispatched, CommandStatus.Rejected].some((candidateValue) => candidateValue === known.status)) return known
    const key = lane(command)
    const pending = [...this.pending.values()].find((value) => lane(value) === key)

    if (this.active.has(key) || (pending && intent(pending) !== intent(command))) throw new Error(ErrorCode.COMMAND_PENDING_STATUS)
    if (!pending && this.pending.size >= COMMAND_PENDING_LIMIT) throw new Error(ErrorCode.COMMAND_QUEUE_FULL)
    const attempted = pending ?? structuredClone(command)

    this.active.add(key)

    try {
      if (pending) {
        try {
          const result = await this.request("GET", "/commands/" + encodeURIComponent(attempted.commandId))

          return this.complete(result)
        } catch (error) {
          const known = this.knownResult(attempted.commandId)

          if (known) return known
          if ((error as { status?: number }).status !== HttpStatus.NotFound) throw new Error(ErrorCode.COMMAND_STATUS_UNKNOWN)
        }
      }

      this.pending.set(attempted.commandId, attempted)

      try {
        const result = await this.request("POST", "/commands", attempted)

        return this.complete(result)
      } catch (error) {
        const known = this.knownResult(attempted.commandId)

        if (known) return known
        const status = (error as { status?: number }).status

        if (status && status >= HttpStatus.BadRequest && status < HttpStatus.InternalServerError) {
          this.pending.delete(attempted.commandId)
          throw error
        }

        try {
          const result = await this.request("GET", "/commands/" + encodeURIComponent(attempted.commandId))

          return this.complete(result)
        } catch {
          const latest = this.knownResult(attempted.commandId)

          if (latest) return latest
          throw new Error(ErrorCode.COMMAND_STATUS_UNKNOWN)
        }
      }
    } finally {
      this.active.delete(key)
    }
  }
}
