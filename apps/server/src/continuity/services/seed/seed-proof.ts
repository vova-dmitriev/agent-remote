import {
  CommandActionType,
  CommandStatus,
  FrameType,
  HandoffPhase,
  handoffSeedProofFrameSchema,
  type HandoffSeedProofFrame,
} from '@protocol';
import { type Principal } from '../../../auth/security.js';
import { Fault } from '../../../http/errors/fault.js';
import type { Database } from '../../../db/database.js';
import { ContinuityRepository } from '../../repository.js';
import { ContinuityError, type ContinuityReadScope } from '../../types.js';
import { uuid } from '../values.js';

export class AuthenticatedSeedProofService {
  private readonly repository = new ContinuityRepository();
  constructor(
    private readonly database: Database,
    private readonly now = Date.now,
  ) {}

  record(principal: Principal, scope: ContinuityReadScope, raw: HandoffSeedProofFrame) {
    const proof = handoffSeedProofFrameSchema.parse(raw);

    if (proof.type !== FrameType.HandoffSeedProof) {
      throw new Fault(ContinuityError.SeedProofMismatch);
    }

    return this.database.transaction(async (tx) => {
      const device = await this.repository.device(
        tx,
        principal.userId,
        scope.deviceId,
        scope.deviceGeneration,
      );

      const operation = await this.repository.operation(
        tx,
        principal.userId,
        scope.deviceId,
        uuid.parse(proof.operationId),
        true,
      );

      const value = operation.value;

      if (
        value.phase !== HandoffPhase.DeliveringContext ||
        value.seedCommandId !== proof.seedCommandId ||
        value.checkpointId !== proof.checkpointId ||
        value.checkpointDigest !== proof.checkpointDigest ||
        value.targetExecutionId !== proof.targetExecutionId ||
        value.selection.provider !== proof.selection.provider ||
        value.selection.profileId !== proof.selection.profileId ||
        value.selection.model !== proof.selection.model ||
        value.selection.effort !== proof.selection.effort
      ) {
        throw new Fault(ContinuityError.SeedProofMismatch);
      }

      if (
        !(await this.repository.seedClaim(
          tx,
          principal.userId,
          scope.deviceId,
          value.id,
          value.seedCommandId,
        ))
      ) {
        throw new Fault(ContinuityError.SeedProofMismatch);
      }

      const target = await this.repository.execution(
        tx,
        principal.userId,
        scope.deviceId,
        value.conversationId,
        value.targetExecutionId,
      );

      const receipt = await this.repository.command(
        tx,
        principal.userId,
        scope.deviceId,
        value.seedCommandId,
      );

      if (
        target.generation !== proof.targetGeneration ||
        target.provider !== proof.selection.provider ||
        target.profileId !== proof.selection.profileId ||
        !receipt ||
        receipt.action !== CommandActionType.Prompt ||
        receipt.status !== CommandStatus.Dispatched ||
        receipt.session_id !== target.nativeSessionId
      ) {
        throw new Fault(ContinuityError.SeedProofMismatch);
      }

      const valueRecord = {
        device_generation: device.generation,
        seed_command_id: value.seedCommandId,
        checkpoint_id: value.checkpointId,
        checkpoint_digest: value.checkpointDigest,
        target_execution_id: target.id,
        target_generation: target.generation,
        target_profile_id: target.profileId,
        target_provider: target.provider,
        target_model: proof.selection.model,
        target_effort: proof.selection.effort ?? null,
      };

      const prior = await this.repository.seedProof(tx, principal.userId, scope.deviceId, value.id);

      if (prior) {
        if (
          Object.keys(valueRecord).some(
            (key) => prior[key as keyof typeof prior] !== valueRecord[key as keyof typeof valueRecord],
          )
        ) {
          throw new Fault(ContinuityError.SeedProofMismatch);
        }

        return;
      }

      await this.repository.insertSeedProof(tx, {
        ...valueRecord,
        owner_id: principal.userId,
        device_id: scope.deviceId,
        conversation_id: value.conversationId,
        operation_id: value.id,
        received_at: this.now(),
      });
    });
  }
}
