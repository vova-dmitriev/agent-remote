import { createHash } from 'node:crypto';
import {
  CommandActionType,
  CommandStatus,
  FrameType,
  HandoffPhase,
  handoffSeedIntentFrameSchema,
  type HandoffSeedIntentFrame,
} from '../../../../../packages/protocol/src/index.js';
import { Fault, type Principal } from '../../auth/security.js';
import type { Database } from '../../db/database.js';
import { ContinuityRepository } from '../repository.js';
import { ContinuityError, type ContinuityReadScope } from '../types.js';
import { readySnapshot, uuid } from './values.js';

export class AuthenticatedSeedIntentService {
  private readonly repository = new ContinuityRepository();

  constructor(
    private readonly database: Database,
    private readonly now = Date.now,
  ) {}

  admit(principal: Principal, scope: ContinuityReadScope, raw: HandoffSeedIntentFrame) {
    const intent = handoffSeedIntentFrameSchema.parse(raw);

    if (intent.type !== FrameType.HandoffSeedIntent) {
      throw new Fault(ContinuityError.SeedIntentMismatch, 409);
    }

    return this.database.transaction(async (tx) => {
      const device = await this.repository.device(
        tx,
        principal.userId,
        scope.deviceId,
        scope.deviceGeneration,
      );

      const state = await this.repository.operation(
        tx,
        principal.userId,
        scope.deviceId,
        uuid.parse(intent.operationId),
        true,
      );

      const operation = state.value;

      if (
        operation.phase !== HandoffPhase.DeliveringContext ||
        operation.seedCommandId !== intent.seedCommandId ||
        operation.checkpointId !== intent.checkpointId ||
        operation.checkpointDigest !== intent.checkpointDigest ||
        operation.targetExecutionId !== intent.targetExecutionId ||
        operation.selection.provider !== intent.selection.provider ||
        operation.selection.profileId !== intent.selection.profileId ||
        operation.selection.model !== intent.selection.model ||
        operation.selection.effort !== intent.selection.effort
      ) {
        throw new Fault(ContinuityError.SeedIntentMismatch, 409);
      }

      const target = await this.repository.execution(
        tx,
        principal.userId,
        scope.deviceId,
        operation.conversationId,
        operation.targetExecutionId,
      );

      if (
        target.generation !== intent.targetGeneration ||
        target.provider !== intent.selection.provider ||
        target.profileId !== intent.selection.profileId ||
        !(await this.repository.seedClaim(
          tx,
          principal.userId,
          scope.deviceId,
          operation.id,
          operation.seedCommandId,
        )) ||
        !readySnapshot(device.snapshot, target)
      ) {
        throw new Fault(ContinuityError.SeedIntentMismatch, 409);
      }

      const fingerprint = createHash('sha256').update(JSON.stringify(intent)).digest('hex');

      const previous = await this.repository.command(
        tx,
        principal.userId,
        scope.deviceId,
        operation.seedCommandId,
      );

      if (previous) {
        if (
          previous.action !== CommandActionType.Prompt ||
          previous.session_id !== target.nativeSessionId ||
          previous.fingerprint !== fingerprint ||
          (previous.status !== CommandStatus.Accepted && previous.status !== CommandStatus.Dispatched)
        ) {
          throw new Fault(ContinuityError.SeedIntentMismatch, 409);
        }

        return;
      }

      await tx.query(
        'INSERT INTO command_audit(owner_id,command_id,device_id,session_id,action,fingerprint,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          principal.userId,
          operation.seedCommandId,
          scope.deviceId,
          target.nativeSessionId,
          CommandActionType.Prompt,
          fingerprint,
          CommandStatus.Accepted,
          this.now(),
        ],
      );
    });
  }
}
