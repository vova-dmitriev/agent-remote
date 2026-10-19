import type { ClientCommand, CommandResult } from "@protocol"
import { CommandSubmission } from "./commands"

export abstract class RelayCommandOperations {
  protected abstract request<T>(path: string, options?: RequestInit): Promise<T>

  protected commands = this.createCommands()

  private createCommands() {
    return new CommandSubmission((method, path, body) => this.request(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }))
  }

  protected resetCommands() {
    this.commands = this.createCommands()
  }

  send = (command: ClientCommand): Promise<CommandResult> => this.commands.send(command)
  retryPending = (commandId?: string) => this.commands.retryPending(commandId)
  checkPending = (commandId: string) => this.commands.checkPending(commandId)
}
