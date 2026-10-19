import {
  CommandActionType,
  CommandStatus,
  ErrorCode,
  HandoffPhase,
  executionLaunchSelectionSchema,
  snapshotSchema,
  type ErrorCode as ErrorCodeType,
  type HandoffOperation,
} from '@protocol';
import { Fault, type Principal } from '../../auth/security.js';
import type { Database } from '../../db/database.js';
import { ContinuityRepository } from '../repository.js';
import {
  ContinuityError,
  HandoffUnsuccessfulPhase,
  type ContinuityReadScope,
  type InitialExecution,
} from '../types.js';
import { uuid } from './values.js';

export class HandoffTransitionService {
  private readonly repository = new ContinuityRepository();
  constructor(
    private readonly database: Database,
    private readonly now = Date.now,
  ) {}

  recordCreatedTarget(
    principal: Principal,
    scope: ContinuityReadScope,
    operationId: string,
    expectedVersion: number,
    input: InitialExecution,
  ): Promise<HandoffOperation> {
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
        uuid.parse(operationId),
        true,
      );

      const op = state.value;

      if (state.version !== expectedVersion || op.phase !== HandoffPhase.CreatingTarget) {
        throw new Fault(ContinuityError.VersionConflict, 409);
      }

      const conversation = await this.repository.conversation(
        tx,
        principal.userId,
        scope.deviceId,
        op.conversationId,
        true,
      );

      if (
        conversation.activeExecutionId !== op.sourceExecutionId ||
        conversation.version !== op.expectedConversationVersion + 1
      ) {
        throw new Fault(ContinuityError.SourceNotActive, 409);
      }

      if (
        input.conversationId !== op.conversationId ||
        input.provider !== op.selection.provider ||
        input.profileId !== op.selection.profileId
      ) {
        throw new Fault(ContinuityError.TargetMismatch, 409);
      }

      const receipt = await this.repository.command(tx, principal.userId, scope.deviceId, op.createCommandId);

      if (
        !receipt ||
        receipt.action !== CommandActionType.CreateSession ||
        receipt.status !== CommandStatus.Dispatched ||
        receipt.result_session_id !== input.nativeSessionId ||
        receipt.create_expected_profile_version !== op.expectedProfileVersion
      ) {
        throw new Fault(ContinuityError.TargetMismatch, 409);
      }

      const selection = executionLaunchSelectionSchema.safeParse(receipt.create_selection);
      const snapshot = snapshotSchema.safeParse(device.snapshot);

      const observed = snapshot.success
        ? snapshot.data.sessions.find((session) => session.id === input.nativeSessionId)
        : undefined;

      if (
        !selection.success ||
        selection.data.provider !== op.selection.provider ||
        selection.data.profileId !== op.selection.profileId ||
        selection.data.model !== op.selection.model ||
        selection.data.effort !== op.selection.effort ||
        !observed ||
        observed.generation !== input.generation ||
        observed.model !== op.selection.model
      ) {
        throw new Fault(ContinuityError.TargetMismatch, 409);
      }

      const link = await this.repository.insertExecution(
        tx,
        { ...input, ownerId: principal.userId, deviceId: scope.deviceId },
        this.now(),
      );

      return (
        await this.repository.setOperationPhase(
          tx,
          principal.userId,
          scope.deviceId,
          op.id,
          expectedVersion,
          HandoffPhase.DeliveringContext,
          null,
          link.id,
          this.now(),
        )
      ).value;
    });
  }

  recordCreatedTargetAtCurrentVersion(
    principal: Principal,
    scope: ContinuityReadScope,
    operationId: string,
    input: InitialExecution,
  ) {
    return this.database.transaction(async (tx) => {
      const state = await this.repository.operation(
        tx,
        principal.userId,
        scope.deviceId,
        uuid.parse(operationId),
        true,
      );

      if (state.value.phase !== HandoffPhase.CreatingTarget) {
        return state.value;
      }

      const op = state.value;

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
        op.conversationId,
        true,
      );

      if (
        conversation.activeExecutionId !== op.sourceExecutionId ||
        conversation.version !== op.expectedConversationVersion + 1
      ) {
        throw new Fault(ContinuityError.SourceNotActive, 409);
      }

      if (
        input.conversationId !== op.conversationId ||
        input.provider !== op.selection.provider ||
        input.profileId !== op.selection.profileId
      ) {
        throw new Fault(ContinuityError.TargetMismatch, 409);
      }

      const receipt = await this.repository.command(tx, principal.userId, scope.deviceId, op.createCommandId);

      if (
        !receipt ||
        receipt.action !== CommandActionType.CreateSession ||
        receipt.status !== CommandStatus.Dispatched ||
        receipt.result_session_id !== input.nativeSessionId ||
        receipt.create_expected_profile_version !== op.expectedProfileVersion
      ) {
        throw new Fault(ContinuityError.TargetMismatch, 409);
      }

      const selection = executionLaunchSelectionSchema.safeParse(receipt.create_selection);
      const snapshot = snapshotSchema.safeParse(device.snapshot);

      const observed = snapshot.success
        ? snapshot.data.sessions.find((session) => session.id === input.nativeSessionId)
        : undefined;

      if (
        !selection.success ||
        selection.data.provider !== op.selection.provider ||
        selection.data.profileId !== op.selection.profileId ||
        selection.data.model !== op.selection.model ||
        selection.data.effort !== op.selection.effort ||
        !observed ||
        observed.generation !== input.generation ||
        observed.model !== op.selection.model
      ) {
        throw new Fault(ContinuityError.TargetMismatch, 409);
      }

      const link = await this.repository.insertExecution(
        tx,
        { ...input, ownerId: principal.userId, deviceId: scope.deviceId },
        this.now(),
      );

      return (
        await this.repository.setOperationPhase(
          tx,
          principal.userId,
          scope.deviceId,
          op.id,
          state.version,
          HandoffPhase.DeliveringContext,
          null,
          link.id,
          this.now(),
        )
      ).value;
    });
  }

  setTerminal(
    principal: Principal,
    scope: ContinuityReadScope,
    operationId: string,
    expectedVersion: number,
    phase: typeof HandoffPhase.Failed | typeof HandoffPhase.Unknown,
    code?: ErrorCodeType,
  ) {
    if (phase !== HandoffUnsuccessfulPhase.Failed && phase !== HandoffUnsuccessfulPhase.Unknown) {
      throw new Fault(ContinuityError.InvalidPhase, 400);
    }

    return this.database.transaction(async (tx) => {
      await this.repository.device(tx, principal.userId, scope.deviceId, scope.deviceGeneration);

      const state = await this.repository.operation(
        tx,
        principal.userId,
        scope.deviceId,
        uuid.parse(operationId),
        true,
      );

      if (
        state.version !== expectedVersion ||
        state.value.phase === HandoffPhase.Ready ||
        state.value.phase === HandoffPhase.Failed
      ) {
        throw new Fault(ContinuityError.VersionConflict, 409);
      }

      const failureCode = phase === HandoffPhase.Failed ? (code ?? ErrorCode.REQUEST_FAILED) : null;

      return (
        await this.repository.setOperationPhase(
          tx,
          principal.userId,
          scope.deviceId,
          state.value.id,
          expectedVersion,
          phase,
          failureCode,
          null,
          this.now(),
        )
      ).value;
    });
  }
}
