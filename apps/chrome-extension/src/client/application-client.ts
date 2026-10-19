import { z } from 'zod';
import {
  ConnectionStatus,
  ErrorCode,
  FrameType,
  LocalOperation,
  resultSchema,
  type ClientCommand,
  type HistoryPageDirection,
  type ServerFrame,
} from '@protocol';
import type { ApplicationClient, TransportHandlers } from '@/shared/api';
import { CommandSubmission } from '@/entities/command';
import { ExtensionPersistence } from './persistence/client.js';
import { ExtensionOperations } from './operations.js';
import { ExtensionMedia } from './media/transfer.js';
import { ExtensionHistory } from './history/controller.js';
import type { ExtensionConnection } from './connection.js';
import { BoundProfileClient } from '@transport/profile-client.js';

const devicesSchema = z.array(z.strictObject({ id: z.string(), last_seen_at: z.string() }));

export class ExtensionApplicationClient extends ExtensionOperations implements ApplicationClient {
  readonly persistence: ExtensionPersistence;
  readonly attachments: ExtensionMedia;
  private commands: CommandSubmission;
  private historyState: ExtensionHistory;
  private stopped = false;
  private unsubscribeConnection: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    connection: ExtensionConnection,
    private handlers: TransportHandlers,
  ) {
    super(connection);
    this.persistence = new ExtensionPersistence(connection);
    this.attachments = new ExtensionMedia(connection);
    this.commands = this.newCommands();
    this.historyState = new ExtensionHistory(connection, this, handlers);
  }

  private newCommands() {
    return new CommandSubmission(async (method, path, command) =>
      resultSchema.parse(
        await this.connection.request(
          method === 'POST' && command
            ? { operation: LocalOperation.Send, command }
            : {
                operation: LocalOperation.Receipt,
                commandId: decodeURIComponent(path.slice('/commands/'.length)),
              },
        ),
      ),
    );
  }

  async start() {
    this.unsubscribe = this.connection.subscribe(this.receive);

    this.unsubscribeConnection = this.connection.subscribeConnection((status) => {
      if (this.stopped) {
        return;
      }

      this.handlers.onConnection(status);

      if (status === ConnectionStatus.Online && this.connection.grant) {
        this.historyState.reconnect();
        this.selectTarget(this.connection.grant.deviceId, this.historyState.selected, false);
      }
    });

    await this.connection.start();
  }

  private receive = (frame: ServerFrame) => {
    if (this.stopped) {
      return;
    }

    if (frame.type === FrameType.CommandResult) {
      frame = { ...frame, result: this.commands.observe(frame.result) };
    }

    if (frame.type === FrameType.Snapshot) {
      if (this.historyState.device && frame.deviceId !== this.historyState.device) {
        return;
      }

      this.historyState.observe(frame);
    }

    this.handlers.onFrame(frame);
  };

  async devices() {
    return devicesSchema.parse(await this.connection.request({ operation: LocalOperation.Devices }));
  }

  profiles(deviceId: string) {
    const grant = this.connection.grant;

    const current = () =>
      !this.stopped && !!grant && this.connection.grant === grant && grant.deviceId === deviceId;

    return new BoundProfileClient(
      deviceId,
      (request) => this.connection.request({ operation: LocalOperation.Profiles, request }),
      current,
    );
  }

  selectTarget(deviceId: string, sessionId: string | null, flush = true) {
    this.historyState.select(deviceId, sessionId, flush);

    if (!this.connection.grant) {
      return;
    }

    if (deviceId !== this.connection.grant.deviceId) {
      this.handlers.onFrame({ type: FrameType.Error, code: ErrorCode.ACCESS_DENIED });

      return;
    }

    const epoch = this.historyState.selection;

    void this.connection.request({ operation: LocalOperation.Select, sessionId }).catch((error: unknown) => {
      if (epoch === this.historyState.selection && !this.stopped) {
        this.handlers.onFrame({
          type: FrameType.Error,
          code: error instanceof Error ? error.message : ErrorCode.REQUEST_FAILED,
        });
      }
    });
  }

  resetTarget() {
    this.selectTarget(this.historyState.device ?? this.connection.grant?.deviceId ?? '', null);
    this.commands = this.newCommands();
  }

  history = (sessionId: string, latest = false) => this.historyState.history(sessionId, latest);
  historyPage = (sessionId: string, direction: HistoryPageDirection, edge?: string) =>
    this.historyState.page(sessionId, direction, edge);

  send = (command: ClientCommand) => this.commands.send(command);
  retryPending = (commandId?: string) => this.commands.retryPending(commandId);
  checkPending = (commandId: string) => this.commands.checkPending(commandId);

  async logout() {
    try {
      await this.connection.request({ operation: LocalOperation.Logout });
    } finally {
      this.close();
    }
  }

  close() {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribeConnection?.();
    this.historyState.close();
    this.attachments.close();
    this.connection.close();
  }
}
