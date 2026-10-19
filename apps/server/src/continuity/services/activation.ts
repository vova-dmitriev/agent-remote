import { CommandActionType, CommandStatus, HandoffPhase } from '@protocol';
import { Fault, type Principal } from '../../auth/security.js';
import type { Database } from '../../db/database.js';
import { ContinuityRepository } from '../repository.js';
import { ContinuityError, type ContinuityReadScope } from '../types.js';
import { readySnapshot, uuid } from './values.js';

export class ExecutionActivationService {
  private readonly repository = new ContinuityRepository();
  constructor(
    private readonly database: Database,
    private readonly now = Date.now,
  ) {}

  activate(
    principal: Principal,
    scope: ContinuityReadScope,
    conversationId: string,
    operationId: string,
    expectedConversationVersion: number,
    expectedOperationVersion: number,
  ) {
    return this.database.transaction(async (tx) => {
      const device = await this.repository.device(
        tx,
        principal.userId,
        scope.deviceId,
        scope.deviceGeneration,
      );

      const conversation = await this.repository.conversation(
        tx,
        principal.userId,
        scope.deviceId,
        uuid.parse(conversationId),
        true,
      );

      const state = await this.repository.operation(
        tx,
        principal.userId,
        scope.deviceId,
        uuid.parse(operationId),
        true,
      );

      const op = state.value;

      if (
        conversation.version !== expectedConversationVersion ||
        state.version !== expectedOperationVersion
      ) {
        throw new Fault(ContinuityError.VersionConflict, 409);
      }

      if (
        conversation.id !== op.conversationId ||
        conversation.activeExecutionId !== op.sourceExecutionId ||
        op.phase !== HandoffPhase.DeliveringContext ||
        !op.targetExecutionId
      ) {
        throw new Fault(ContinuityError.SourceNotActive, 409);
      }

      const target = await this.repository.execution(
        tx,
        principal.userId,
        scope.deviceId,
        conversation.id,
        op.targetExecutionId,
      );

      if (!readySnapshot(device.snapshot, target)) {
        throw new Fault(ContinuityError.TargetNotReady, 409);
      }

      const proof = await this.repository.seedProof(tx, principal.userId, scope.deviceId, op.id);

      if (
        !proof ||
        proof.device_generation !== scope.deviceGeneration ||
        proof.seed_command_id !== op.seedCommandId ||
        proof.checkpoint_id !== op.checkpointId ||
        proof.checkpoint_digest !== op.checkpointDigest ||
        proof.target_execution_id !== target.id ||
        proof.target_generation !== target.generation ||
        proof.target_profile_id !== op.selection.profileId ||
        proof.target_provider !== op.selection.provider ||
        proof.target_model !== op.selection.model ||
        proof.target_effort !== (op.selection.effort ?? null)
      ) {
        throw new Fault(ContinuityError.SeedProofMismatch, 409);
      }

      const receipt = await this.repository.command(tx, principal.userId, scope.deviceId, op.seedCommandId);

      if (
        !receipt ||
        receipt.action !== CommandActionType.Prompt ||
        receipt.status !== CommandStatus.Dispatched ||
        receipt.session_id !== target.nativeSessionId
      ) {
        throw new Fault(ContinuityError.SeedNotDispatched, 409);
      }

      const updated = await this.repository.setActiveExecution(
        tx,
        principal.userId,
        scope.deviceId,
        conversation.id,
        target.id,
        expectedConversationVersion,
        this.now(),
      );

      await this.repository.setOperationPhase(
        tx,
        principal.userId,
        scope.deviceId,
        op.id,
        expectedOperationVersion,
        HandoffPhase.Ready,
        null,
        target.id,
        this.now(),
      );

      return updated;
    });
  }
}
