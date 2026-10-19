import {
  type AttachmentDescriptor,
  attachmentSchema,
  BindingState,
  canDeliverPrompt,
  CapabilityKey,
  CodedError,
  type Command,
  CommandActionType,
  type CommandResult,
  commandSchema,
  CommandStatus,
  ErrorCode,
  IntegrationState,
  type Session,
  TargetKind,
} from '@protocol';
import { DispatchScheduler } from './scheduling/index.js';
import { CommandStoreOutcome, RuntimeEvent } from '../domain/runtime.js';
import { type PreparedAttachment } from '../attachments/types.js';
import type { LocalStorePort } from '../domain/ports/local-store.js';
import type { MonitorPort } from '../domain/ports/monitor.js';
import { type AdapterRegistry } from '../adapters/registry.js';
import { type UserInputBroker } from './user-input-broker.js';
import { type PermissionBroker } from './permission-broker.js';

export interface DispatcherOptions {
  deviceId: string;
  scheduler?: DispatchScheduler;
  store: LocalStorePort;
  monitor: MonitorPort;
  adapters: AdapterRegistry;
  permissions: PermissionBroker;
  userInputs?: UserInputBroker;
  inputEnabled: boolean;
  permissionsEnabled: boolean;
  restartSession?: (session: Session) => Promise<string>;
  createSession?: (
    action: Extract<Command['action'], { type: typeof CommandActionType.CreateSession }>,
    authorize: () => boolean,
  ) => Promise<string>;
  prepareAttachments?: (
    session: Session,
    attachments: AttachmentDescriptor[],
  ) => Promise<PreparedAttachment[]>;
  recordAttachments?: (
    session: Session,
    text: string,
    attachments: PreparedAttachment[],
  ) => void | Promise<void>;
}
export class Dispatcher {
  private scheduler: DispatchScheduler;
  private connected = true;
  private epoch = 0;
  constructor(private options: DispatcherOptions) {
    this.scheduler = options.scheduler ?? new DispatchScheduler();
  }
  setConnection(online: boolean) {
    if (online !== this.connected) {
      this.epoch++;
    }

    this.connected = online;
  }
  dispatch(raw: Command, authorize: () => boolean = () => true): Promise<CommandResult> {
    const parsed = commandSchema.safeParse(raw);

    if (!parsed.success) {
      return Promise.resolve({
        commandId: typeof raw?.commandId === 'string' ? raw.commandId : 'invalid',
        status: CommandStatus.Rejected,
        code: ErrorCode.INVALID_COMMAND,
      });
    }

    const command = parsed.data;
    const current = this.scheduler.inFlight.get(command.commandId);

    if (current) {
      return current.then(() => this.dispatch(command, authorize));
    }

    const queueKey = [CommandActionType.CreateSession, CommandActionType.RestartSession].some(
      (candidateValue) => candidateValue === command.action.type,
    )
      ? 'create:' + this.options.deviceId
      : command.sessionId;

    const previous = this.scheduler.queues.get(queueKey) ?? Promise.resolve();
    const epoch = this.epoch;
    const result = previous.catch(() => {}).then(() => this.execute(command, epoch, authorize));

    this.scheduler.inFlight.set(command.commandId, result);
    this.scheduler.queues.set(queueKey, result);

    const clean = () => {
      if (this.scheduler.inFlight.get(command.commandId) === result) {
        this.scheduler.inFlight.delete(command.commandId);
      }

      if (this.scheduler.queues.get(queueKey) === result) {
        this.scheduler.queues.delete(queueKey);
      }
    };

    void result.then(clean, clean);

    return result;
  }
  async drain() {
    await Promise.allSettled([...this.scheduler.inFlight.values()]);
  }
  private async execute(command: Command, epoch: number, authorize: () => boolean): Promise<CommandResult> {
    try {
      const prior = this.options.store.begin(command);

      if (prior !== CommandStoreOutcome.New) {
        return prior;
      }
    } catch {
      return {
        commandId: command.commandId,
        status: CommandStatus.Rejected,
        code: ErrorCode.COMMAND_STORE_UNAVAILABLE,
      };
    }

    let result: CommandResult;

    try {
      if (!authorize()) {
        throw new CodedError(ErrorCode.LOCAL_GRANT_REVOKED);
      }

      if (!this.connected || epoch !== this.epoch) {
        throw new CodedError(ErrorCode.DEVICE_OFFLINE);
      }

      if (command.expiresAt <= Date.now() || command.expiresAt > Date.now() + 30000) {
        throw new CodedError(ErrorCode.COMMAND_EXPIRED);
      }

      const session = this.options.monitor.session(command.sessionId),
        binding = this.options.monitor.binding(command.sessionId);

      if (
        command.target.deviceId !== this.options.deviceId ||
        !session ||
        (!binding && command.action.type !== CommandActionType.RestartSession) ||
        JSON.stringify(command.target) !== JSON.stringify(session.target)
      ) {
        throw new CodedError(ErrorCode.NOT_FOUND);
      }

      if (
        session.generation !== command.generation ||
        (command.action.type !== CommandActionType.RestartSession &&
          (session.binding !== BindingState.Verified || session.integrationState !== IntegrationState.Ready))
      ) {
        throw new CodedError(ErrorCode.STALE_SESSION);
      }

      let capability: keyof typeof session.capabilities;

      switch (command.action.type) {
        case CommandActionType.Escape:
          capability = CapabilityKey.Interrupt;
          break;
        case CommandActionType.UserInput:
          capability = CapabilityKey.UserInput;
          break;
        case CommandActionType.CreateSession:
          capability = CapabilityKey.CreateSession;
          break;
        case CommandActionType.RestartSession:
          capability = CapabilityKey.RestartSession;
          break;
        default:
          capability = command.action.type;
      }

      if (
        !session.capabilities[capability] ||
        (command.action.type === CommandActionType.Permission
          ? !this.options.permissionsEnabled
          : !this.options.inputEnabled)
      ) {
        throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
      }

      if (
        command.action.type === CommandActionType.Prompt &&
        !canDeliverPrompt(session.status, command.action.delivery)
      ) {
        throw new CodedError(ErrorCode.SESSION_NOT_IDLE);
      }

      let prepared: PreparedAttachment[] | undefined;

      if (command.action.type === CommandActionType.Prompt && command.action.attachments?.length) {
        if (!session.capabilities.attachments || !this.options.prepareAttachments) {
          throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
        }

        prepared = await this.options.prepareAttachments(session, command.action.attachments);

        // Downloads cross await boundaries. Recheck every effect fence against live source state.
        if (!authorize()) {
          throw new CodedError(ErrorCode.LOCAL_GRANT_REVOKED);
        }

        if (!this.connected || epoch !== this.epoch) {
          throw new CodedError(ErrorCode.DEVICE_OFFLINE);
        }

        if (command.expiresAt <= Date.now()) {
          throw new CodedError(ErrorCode.COMMAND_EXPIRED);
        }

        const current = this.options.monitor.session(command.sessionId),
          currentBinding = this.options.monitor.binding(command.sessionId);

        if (
          !current ||
          !currentBinding ||
          current.generation !== command.generation ||
          current.binding !== BindingState.Verified ||
          current.integrationState !== IntegrationState.Ready ||
          currentBinding.generation !== binding?.generation ||
          currentBinding.localProof !== binding?.localProof
        ) {
          throw new CodedError(ErrorCode.STALE_SESSION);
        }

        if (!current.capabilities.prompt || !current.capabilities.attachments || !this.options.inputEnabled) {
          throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
        }

        if (!canDeliverPrompt(current.status, command.action.delivery)) {
          throw new CodedError(ErrorCode.SESSION_NOT_IDLE);
        }

        if (
          JSON.stringify(prepared.map((item) => attachmentSchema.parse(item.descriptor))) !==
          JSON.stringify(command.action.attachments)
        ) {
          throw new CodedError(ErrorCode.ATTACHMENT_INTEGRITY_FAILED);
        }

        await this.options.recordAttachments?.(current, command.action.text, prepared);

        if (!authorize()) {
          throw new CodedError(ErrorCode.LOCAL_GRANT_REVOKED);
        }

        if (!this.connected || epoch !== this.epoch) {
          throw new CodedError(ErrorCode.DEVICE_OFFLINE);
        }

        if (command.expiresAt <= Date.now()) {
          throw new CodedError(ErrorCode.COMMAND_EXPIRED);
        }

        if (
          this.options.monitor.session(command.sessionId) !== current ||
          current.generation !== command.generation ||
          current.binding !== BindingState.Verified ||
          current.integrationState !== IntegrationState.Ready
        ) {
          throw new CodedError(ErrorCode.STALE_SESSION);
        }

        if (!current.capabilities.prompt || !current.capabilities.attachments || !this.options.inputEnabled) {
          throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
        }

        if (this.options.monitor.binding(command.sessionId)?.localProof !== currentBinding.localProof) {
          throw new CodedError(ErrorCode.STALE_SESSION);
        }

        if (!canDeliverPrompt(current.status, command.action.delivery)) {
          throw new CodedError(ErrorCode.SESSION_NOT_IDLE);
        }
      }

      if (command.action.type === CommandActionType.RestartSession) {
        if (!this.options.restartSession) {
          throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
        }

        const sessionId = await this.options.restartSession(session);

        result = { commandId: command.commandId, status: CommandStatus.Dispatched, sessionId };
      } else if (command.action.type === CommandActionType.CreateSession) {
        if (command.action.cwd !== session.cwd) {
          throw new CodedError(ErrorCode.INVALID_PROJECT);
        }

        if (!this.options.createSession) {
          throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
        }

        const sessionId = await this.options.createSession(command.action, authorize);

        result = { commandId: command.commandId, status: CommandStatus.Dispatched, sessionId };
      } else if (command.action.type === CommandActionType.UserInput) {
        const requestId = command.action.requestId;

        const pending = this.options.userInputs
          ?.pending()
          .find(
            (request) =>
              request.requestId === requestId &&
              request.sessionId === session.id &&
              request.generation === session.generation,
          );

        if (!pending || !this.options.userInputs) {
          throw new CodedError(ErrorCode.USER_INPUT_EXPIRED);
        }

        await this.options.userInputs.submit(pending.requestId, command.generation, command.action.answers);
        result = { commandId: command.commandId, status: CommandStatus.Dispatched };
      } else if (command.action.type === CommandActionType.Permission) {
        const requestId = command.action.requestId;

        const pending = this.options.permissions
          .pending()
          .find(
            (r) =>
              r.requestId === requestId && r.sessionId === session.id && r.generation === session.generation,
          );

        if (
          !pending ||
          !this.options.permissions.resolve(
            command.action.requestId,
            command.generation,
            command.action.decision,
          )
        ) {
          throw new CodedError(ErrorCode.PERMISSION_EXPIRED);
        }

        result = { commandId: command.commandId, status: CommandStatus.Dispatched };
      } else {
        if (
          command.action.type === CommandActionType.Escape &&
          ![TargetKind.Cmux, TargetKind.ClaudeCodeCli].some(
            (candidateValue) => candidateValue === command.target.kind,
          )
        ) {
          throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
        }

        if (!binding) {
          throw new CodedError(ErrorCode.STALE_SESSION);
        }

        const adapter = this.options.adapters.resolve(command.target);

        const receipt =
          command.action.type === CommandActionType.Prompt
            ? await adapter.sendPrompt(binding, command.action.text, prepared, command.action.delivery)
            : await adapter.interrupt(binding);

        result = { commandId: command.commandId, ...receipt };
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN';

      result = {
        commandId: command.commandId,
        status: [
          ErrorCode.UNKNOWN_AFTER_WRITE,
          ErrorCode.WRAPPER_TIMEOUT,
          ErrorCode.HELPER_TIMEOUT,
          ErrorCode.HELPER_EXITED,
        ].some((candidateValue) => candidateValue === code)
          ? CommandStatus.Unknown
          : CommandStatus.Rejected,
        code: /^[A-Z_]+$/.test(code) ? code : ErrorCode.ADAPTER_FAILED,
      };
    }

    try {
      this.options.store.finish(result);
    } catch {
      result = {
        commandId: command.commandId,
        status: CommandStatus.Unknown,
        code: ErrorCode.COMMAND_STORE_UNAVAILABLE,
      };
    }

    this.options.monitor.emit(RuntimeEvent.Snapshot);

    return result;
  }
}
