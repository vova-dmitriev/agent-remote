import { z } from "zod"
import {
  ConnectionStatus,
  ErrorCode,
  FrameType,
  HistoryDirection,
  LocalOperation,
  resultSchema,
  type ClientCommand,
  type HistoryNavigationDirection,
  type HistoryPageDirection,
  type ServerFrame,
} from "@protocol"
import { BoundProfileClient } from "@transport/profile-client.js"
import type { ApplicationClient, TransportHandlers } from "@/shared/api"
import { CommandSubmission } from "@/entities/command"
import { DesktopHistory } from "./history.js"
import { DesktopMedia } from "./media.js"
import { DesktopOperations } from "./operations.js"
import { DesktopPersistence } from "./persistence.js"
import type { DesktopBridgeConnection } from "./desktop-connection.js"

const devicesSchema = z.array(z.strictObject({ id: z.string(), last_seen_at: z.string() }))

function parseCommandResult(raw: unknown) {
  try {
    return resultSchema.parse(raw)
  } catch {
    throw new Error(ErrorCode.INVALID_REQUEST)
  }
}

function parseCommandId(path: string): string {
  try {
    return decodeURIComponent(path.slice("/commands/".length))
  } catch {
    throw new Error(ErrorCode.INVALID_REQUEST)
  }
}

export class DesktopApplicationClient implements ApplicationClient {
  readonly attachments: DesktopMedia
  readonly persistence: DesktopPersistence
  private commands: CommandSubmission
  private historyClient: DesktopHistory
  private operations: DesktopOperations
  private stopped = false
  private selectedDevice: string | null = null
  private boundDevice: string | null = null
  private selectedSession: string | null = null
  private selection = 0
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly connection: DesktopBridgeConnection,
    private readonly handlers: TransportHandlers,
  ) {
    this.attachments = new DesktopMedia(connection)
    this.persistence = new DesktopPersistence(connection)
    this.historyClient = new DesktopHistory(connection, handlers)
    this.operations = new DesktopOperations(connection)
    this.commands = this.newCommands()
  }

  private newCommands() {
    return new CommandSubmission((method, path, command) =>
      this.connection
        .request(
          method === "POST" && command
            ? { operation: LocalOperation.Send, command }
            : { operation: LocalOperation.Receipt, commandId: parseCommandId(path) },
        )
        .then(parseCommandResult),
    )
  }

  async start(): Promise<void> {
    this.handlers.onConnection(ConnectionStatus.Connecting)
    this.unsubscribe = this.connection.subscribe((event) => this.receive(event.frame))
    await this.connection.start()

    if (!this.stopped) this.handlers.onConnection(ConnectionStatus.Online)
  }

  private receive(frame: ServerFrame): void {
    if (this.stopped) return

    if (frame.type === FrameType.Snapshot) this.boundDevice = frame.deviceId

    if (frame.type === FrameType.CommandResult) {
      frame = { ...frame, result: this.commands.observe(parseCommandResult(frame.result)) }
    }

    this.historyClient.observe(frame)
    this.handlers.onFrame(frame)
  }

  devices() {
    return this.connection.request({ operation: LocalOperation.Devices }).then((raw) => devicesSchema.parse(raw))
  }

  profiles(deviceId: string) {
    // The companion serves exactly one device, announced by its snapshot; foreign ids never reach it.
    const current = () => !this.stopped && this.boundDevice === deviceId

    return new BoundProfileClient(
      deviceId,
      async (request) => {
        const selection = this.selection
        const response = await this.connection.request({ operation: LocalOperation.Profiles, request })

        if (!current() || selection !== this.selection) {
          throw new Error(ErrorCode.STALE_EPOCH)
        }

        return response
      },
      current,
    )
  }

  selectTarget(deviceId: string, sessionId: string | null): void {
    this.selectedDevice = deviceId
    this.selectedSession = sessionId
    const selection = ++this.selection

    void this.connection.request({ operation: LocalOperation.Select, sessionId }).catch((error: unknown) => {
      if (selection === this.selection && !this.stopped) {
        this.handlers.onFrame({
          type: FrameType.Error,
          code: error instanceof Error ? error.message : ErrorCode.REQUEST_FAILED,
        })
      }
    })
  }

  resetTarget(): void {
    this.selectTarget(this.selectedDevice ?? "", null)
    this.commands = this.newCommands()
  }

  history = (sessionId: string, _latest = false) => this.historyClient.load(sessionId)
  historyPage = (sessionId: string, direction: HistoryPageDirection, edge?: string) => this.historyClient.page(sessionId, direction, edge)
  subagentHistory = (sessionId: string, agentId: string, direction: HistoryNavigationDirection, edge?: string) =>
    direction === HistoryDirection.Latest
      ? this.historyClient.load(sessionId, agentId)
      : this.historyClient.page(sessionId, direction, edge, agentId)
  send = (command: ClientCommand) => this.commands.send(command)
  retryPending = (commandId?: string) => this.commands.retryPending(commandId)
  checkPending = (commandId: string) => this.commands.checkPending(commandId)

  getPreferences = () => this.operations.getPreferences()
  savePreferences = (patch: Parameters<ApplicationClient["savePreferences"]>[0]) => this.operations.savePreferences(patch)
  renameSession = (sessionId: string, title: string, generation: string) => this.operations.renameSession(sessionId, title, generation)
  pinSession = (sessionId: string, generation: string, pinned: boolean) => this.operations.pinSession(sessionId, generation, pinned)
  readSessionFile = (sessionId: string, generation: string, path: string) => this.operations.readSessionFile(sessionId, generation, path)
  getReadingPosition = (sessionId: string) => this.operations.getReadingPosition(sessionId)
  saveReadingPosition = (sessionId: string, position: Parameters<ApplicationClient["saveReadingPosition"]>[1]) =>
    this.operations.saveReadingPosition(sessionId, position)

  async claimDevice(_code: string): Promise<never> {
    throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE)
  }

  async revokeDevice(_deviceId: string): Promise<never> {
    throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE)
  }

  async logout(): Promise<void> {
    try {
      await this.connection.request({ operation: LocalOperation.Logout })
    } finally {
      this.close()
    }
  }

  close(): void {
    this.stopped = true
    this.unsubscribe?.()
    this.attachments.close()
    void this.connection.close()
  }
}
