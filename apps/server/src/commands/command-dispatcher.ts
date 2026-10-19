import { Inject, Injectable } from '@nestjs/common';
import {
  BindingState,
  CapabilityKey,
  ConnectorId,
  CommandActionType,
  CommandStatus,
  ErrorCode,
  FrameType,
  HandoffPhase,
  IntegrationState,
  SessionStatus,
  TargetKind,
  canDeliverPrompt,
  clientCommandSchema,
  snapshotSchema,
  validateUserInputAnswers,
  type ClientCommand,
  type CommandResult,
} from '@protocol';
import { RELAY_CONFIG, type RelayConfig } from '../app/relay-config.js';
import { AttachmentService } from '../attachments/service.js';
import { Limiter, hash, type Principal } from '../auth/security.js';
import { ContinuityService } from '../continuity/service.js';
import { ContinuityError } from '../continuity/types.js';
import { Database } from '../db/database.js';
import { emptySnapshot } from '../devices/device-state.js';
import { DeviceFence } from '../devices/fence.js';
import { DeviceService } from '../devices/service.js';
import { Fault } from '../http/errors/fault.js';
import { RelayHub } from '../realtime/relay-hub.js';
import { claimHandoffCreateCommandId, claimRelayCommandId } from './command-claims.js';

function commandCapability(action: ClientCommand['action']['type']) {
  switch (action) {
    case CommandActionType.Escape:
      return CapabilityKey.Interrupt;
    case CommandActionType.UserInput:
      return CapabilityKey.UserInput;
    case CommandActionType.CreateSession:
      return CapabilityKey.CreateSession;
    case CommandActionType.RestartSession:
      return CapabilityKey.RestartSession;
    default:
      return action;
  }
}

/** Validates a client command against the device snapshot, records it once in `command_audit` and sends it to the device. */
@Injectable()
export class CommandDispatcher {
  constructor(
    @Inject(RELAY_CONFIG) private readonly config: RelayConfig,
    @Inject(Database) private readonly db: Database,
    @Inject(DeviceService) private readonly devices: DeviceService,
    @Inject(DeviceFence) private readonly fence: DeviceFence,
    @Inject(Limiter) private readonly limiter: Limiter,
    @Inject(ContinuityService) private readonly continuity: ContinuityService,
    @Inject(AttachmentService) private readonly attachments: AttachmentService,
    @Inject(RelayHub) private readonly hub: RelayHub,
  ) {}

  readonly command = async (p: Principal, input: ClientCommand): Promise<CommandResult> => {
    const { fence } = this;
    const parsed = clientCommandSchema.parse(input);

    return fence.run(parsed.target.deviceId, () => this.executeCommand(p, parsed));
  };

  readonly dispatchHandoffCreate = async (p: Principal, operationId: string): Promise<CommandResult> => {
    const { db, devices, fence, continuity } = this;

    const row = (
      await db.pool.query<{ device_id: string }>(
        'SELECT device_id FROM handoff_operations WHERE owner_id=$1 AND id=$2',
        [p.userId, operationId],
      )
    ).rows[0];

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    return fence.run(row.device_id, async () => {
      const device = await devices.owned(p, row.device_id);
      const scope = { deviceId: device.id, deviceGeneration: device.generation };
      const operation = await continuity.getHandoff(p, scope, operationId);

      if (operation.phase !== HandoffPhase.CreatingTarget) {
        throw new Fault(ContinuityError.InvalidPhase);
      }

      const conversation = await continuity.getConversation(p, scope, operation.conversationId);

      const source = await continuity.getExecution(
        p,
        scope,
        operation.conversationId,
        operation.sourceExecutionId,
      );

      const snapshot = device.snapshot ? snapshotSchema.parse(device.snapshot) : emptySnapshot();

      const session = snapshot.sessions.find(
        (candidate) =>
          candidate.id === source.nativeSessionId && candidate.generation === operation.sourceGeneration,
      );

      if (
        conversation.activeExecutionId !== operation.sourceExecutionId ||
        conversation.version !== operation.expectedConversationVersion + 1 ||
        source.generation !== operation.sourceGeneration ||
        !session?.cwd
      ) {
        throw new Fault(ErrorCode.STALE_SESSION);
      }

      const input = clientCommandSchema.parse({
        commandId: operation.createCommandId,
        target: session.target,
        sessionId: session.id,
        generation: session.generation,
        action: {
          type: CommandActionType.CreateSession,
          provider: operation.selection.provider,
          cwd: session.cwd,
          execution: {
            selection: operation.selection,
            expectedVersion: operation.expectedProfileVersion,
          },
        },
      });

      return this.executeCommand(p, input, operation.id);
    });
  };

  private async executeCommand(
    p: Principal,
    input: ClientCommand,
    handoffOperationId?: string,
  ): Promise<CommandResult> {
    const { config, db, devices, limiter, attachments } = this;
    const { live, send } = this.hub;
    const source = clientCommandSchema.parse(input);

    await devices.owned(p, source.target.deviceId);
    const fingerprint = hash(JSON.stringify(source));

    const previous = (
      await db.pool.query<{
        fingerprint: string;
        status: CommandResult['status'];
        code: string | null;
        result_session_id: string | null;
      }>(
        'SELECT fingerprint,status,code,result_session_id FROM command_audit WHERE owner_id=$1 AND command_id=$2',
        [p.userId, source.commandId],
      )
    ).rows[0];

    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new Fault(ErrorCode.COMMAND_ID_REUSED);
      }

      await db.transaction((tx) =>
        handoffOperationId
          ? claimHandoffCreateCommandId(
              tx,
              p.userId,
              source.target.deviceId,
              source.commandId,
              handoffOperationId,
              fingerprint,
              Date.now(),
            )
          : claimRelayCommandId(
              tx,
              p.userId,
              source.target.deviceId,
              source.commandId,
              fingerprint,
              Date.now(),
            ),
      );

      return {
        commandId: source.commandId,
        status: previous.status,
        ...(previous.code ? { code: previous.code } : {}),
        ...(previous.result_session_id ? { sessionId: previous.result_session_id } : {}),
      };
    }

    limiter.take('command:' + p.userId, 30);
    const connection = live.get(source.target.deviceId);

    if (!connection) {
      throw new Fault(ErrorCode.DEVICE_OFFLINE);
    }

    const device = await devices.owned(p, source.target.deviceId);
    const data = device.snapshot ? snapshotSchema.parse(device.snapshot) : emptySnapshot();
    const session = data.sessions.find((s) => s.id === source.sessionId);

    if (!session || JSON.stringify(session.target) !== JSON.stringify(source.target)) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    if (
      session.generation !== source.generation ||
      (source.action.type !== CommandActionType.RestartSession &&
        (session.binding !== BindingState.Verified || session.integrationState !== IntegrationState.Ready))
    ) {
      throw new Fault(ErrorCode.STALE_SESSION);
    }

    const capability = commandCapability(source.action.type);

    if (
      !session.capabilities[capability] ||
      (source.action.type === CommandActionType.Permission
        ? !config.permissionsEnabled
        : !config.inputEnabled)
    ) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    if (
      source.action.type === CommandActionType.RestartSession &&
      (session.target.kind !== TargetKind.ClaudeCodeCli || session.target.connectorId !== ConnectorId.Native)
    ) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    if (
      source.action.type === CommandActionType.Escape &&
      ![TargetKind.Cmux, TargetKind.ClaudeCodeCli].some(
        (candidateValue) => candidateValue === session.target.kind,
      )
    ) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    if (source.action.type === CommandActionType.CreateSession && source.action.cwd !== session.cwd) {
      throw new Fault(ErrorCode.INVALID_PROJECT);
    }

    if (
      source.action.type === CommandActionType.Prompt &&
      !canDeliverPrompt(session.status, source.action.delivery)
    ) {
      throw new Fault(ErrorCode.SESSION_NOT_IDLE);
    }

    if (source.action.type === CommandActionType.Prompt && source.action.attachments?.length) {
      if (!session.capabilities.attachments) {
        throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE);
      }

      await attachments.validate(
        { ownerId: p.userId, deviceId: device.id, sessionId: session.id },
        source.action.attachments,
      );
    }

    let expiresAt = Date.now() + 15000;

    if (source.action.type === CommandActionType.Permission) {
      const requestId = source.action.requestId;

      const pending = data.permissions.find(
        (r) => r.requestId === requestId && r.sessionId === session.id && r.generation === session.generation,
      );

      if (!pending || pending.expiresAt <= Date.now()) {
        throw new Fault(ErrorCode.PERMISSION_EXPIRED);
      }

      expiresAt = Math.min(expiresAt, pending.expiresAt);
    }

    if (source.action.type === CommandActionType.UserInput) {
      const requestId = source.action.requestId;

      const pending = data.userInputs?.find(
        (request) =>
          request.requestId === requestId &&
          request.sessionId === session.id &&
          request.generation === session.generation,
      );

      if (!pending || pending.expiresAt <= Date.now() || session.status === SessionStatus.Ended) {
        throw new Fault(ErrorCode.USER_INPUT_EXPIRED);
      }

      try {
        validateUserInputAnswers(pending, source.action.answers);
      } catch {
        throw new Fault(ErrorCode.INVALID_USER_INPUT);
      }

      expiresAt = Math.min(expiresAt, pending.expiresAt);
    }

    const inserted = await db.transaction(async (tx) => {
      if (handoffOperationId && source.action.type !== CommandActionType.CreateSession) {
        throw new Fault(ContinuityError.CommandIdReserved);
      }

      const claimed = handoffOperationId
        ? await claimHandoffCreateCommandId(
            tx,
            p.userId,
            source.target.deviceId,
            source.commandId,
            handoffOperationId,
            fingerprint,
            Date.now(),
          )
        : await claimRelayCommandId(
            tx,
            p.userId,
            source.target.deviceId,
            source.commandId,
            fingerprint,
            Date.now(),
          );

      if (!claimed) {
        return { rowCount: 0 };
      }

      const createEvidence =
        source.action.type === CommandActionType.CreateSession && source.action.execution
          ? {
              selection: source.action.execution.selection,
              version: source.action.execution.expectedVersion,
            }
          : null;

      return tx.query(
        'INSERT INTO command_audit(owner_id,command_id,device_id,session_id,action,fingerprint,status,created_at,create_selection,create_expected_profile_version) VALUES($1,$2,$3,$4,$5,$6,$8,$7,$9,$10) ON CONFLICT DO NOTHING RETURNING command_id',
        [
          p.userId,
          source.commandId,
          source.target.deviceId,
          source.sessionId,
          source.action.type,
          fingerprint,
          Date.now(),
          CommandStatus.Accepted,
          createEvidence?.selection ?? null,
          createEvidence?.version ?? null,
        ],
      );
    });

    if (!inserted.rowCount) {
      return this.executeCommand(p, source);
    }

    if (live.get(source.target.deviceId) !== connection) {
      await db.pool.query('UPDATE command_audit SET status=$3,code=$4 WHERE owner_id=$1 AND command_id=$2', [
        p.userId,
        source.commandId,
        CommandStatus.Rejected,
        ErrorCode.DEVICE_OFFLINE,
      ]);

      return { commandId: source.commandId, status: CommandStatus.Rejected, code: 'DEVICE_OFFLINE' };
    }

    send(connection.socket, { type: FrameType.Command, command: { version: 1, ...source, expiresAt } });

    return { commandId: source.commandId, status: CommandStatus.Accepted };
  }
}
