import type { PoolClient } from 'pg';
import { CommandActionType, CommandStatus, HandoffPhase, type HandoffOperation } from '@protocol';
import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import { ormOn } from '../../db/database.js';
import { commandAudit, handoffCommandIds, handoffOperations } from '../../db/schema/index.js';
import { Fault } from '../../http/errors/fault.js';
import { ContinuityError, HandoffCommandKind, type PersistHandoffInput } from '../types.js';
import { asOperation } from './mapping.js';

export interface OperationState {
  value: HandoffOperation;
  version: number;
  fingerprint: string;
}

const operationOf = (ownerId: string, deviceId: string, id: string) =>
  and(
    eq(handoffOperations.ownerId, ownerId),
    eq(handoffOperations.deviceId, deviceId),
    eq(handoffOperations.id, id),
  );

/** A conversation's operations that have not finished. */
const unfinishedOf = (ownerId: string, deviceId: string, conversationId: string) =>
  and(
    eq(handoffOperations.ownerId, ownerId),
    eq(handoffOperations.deviceId, deviceId),
    eq(handoffOperations.conversationId, conversationId),
    notInArray(handoffOperations.phase, [HandoffPhase.Ready, HandoffPhase.Failed]),
  );

const asState = (row: typeof handoffOperations.$inferSelect): OperationState => ({
  value: asOperation(row),
  version: row.operationVersion,
  fingerprint: row.requestFingerprint.trim(),
});

export class HandoffRepository {
  async operation(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    id: string,
    lock = false,
  ): Promise<OperationState> {
    const query = ormOn(tx)
      .select()
      .from(handoffOperations)
      .where(operationOf(ownerId, deviceId, id));

    const [row] = lock ? await query.for('update') : await query;

    if (!row) {
      throw new Fault(ContinuityError.NotFound);
    }

    return asState(row);
  }

  async findOperation(tx: PoolClient, ownerId: string, deviceId: string, id: string) {
    const [row] = await ormOn(tx)
      .select()
      .from(handoffOperations)
      .where(operationOf(ownerId, deviceId, id));

    return row ? asState(row) : null;
  }

  async insertOperation(tx: PoolClient, input: PersistHandoffInput, fingerprint: string, now: number) {
    const request = input.request;
    const orm = ormOn(tx);

    await orm.insert(handoffOperations).values({
      id: input.operationId,
      ownerId: request.ownerId,
      deviceId: request.deviceId,
      conversationId: request.conversationId,
      sourceExecutionId: request.sourceExecutionId,
      sourceGeneration: request.sourceGeneration,
      checkpointId: request.checkpointId,
      checkpointDigest: request.checkpointDigest,
      expectedConversationVersion: request.expectedConversationVersion,
      expectedProfileVersion: request.expectedProfileVersion,
      targetProvider: request.selection.provider,
      targetProfileId: request.selection.profileId,
      targetModel: request.selection.model,
      targetEffort: request.selection.effort ?? null,
      phase: HandoffPhase.CreatingTarget,
      createCommandId: input.createCommandId,
      seedCommandId: input.seedCommandId,
      requestFingerprint: fingerprint,
      createdAt: now,
      updatedAt: now,
    });

    const command = (commandId: string, kind: string) => ({
      commandId,
      ownerId: request.ownerId,
      deviceId: request.deviceId,
      operationId: input.operationId,
      kind,
    });

    await orm
      .insert(handoffCommandIds)
      .values([
        command(input.createCommandId, HandoffCommandKind.Create),
        command(input.seedCommandId, HandoffCommandKind.Seed),
        command(input.operationId, HandoffCommandKind.Operation),
      ]);
  }

  async activeOperation(tx: PoolClient, ownerId: string, deviceId: string, conversationId: string) {
    const rows = await ormOn(tx)
      .select({ id: handoffOperations.id })
      .from(handoffOperations)
      .where(unfinishedOf(ownerId, deviceId, conversationId))
      .limit(1);

    return rows.length > 0;
  }

  async pendingOperation(tx: PoolClient, ownerId: string, deviceId: string, conversationId: string) {
    const [row] = await ormOn(tx)
      .select()
      .from(handoffOperations)
      .where(unfinishedOf(ownerId, deviceId, conversationId))
      .orderBy(desc(handoffOperations.updatedAt))
      .limit(1);

    return row ? asOperation(row) : null;
  }

  async command(tx: PoolClient, ownerId: string, deviceId: string, commandId: string) {
    const [row] = await ormOn(tx)
      .select({
        action: commandAudit.action,
        fingerprint: commandAudit.fingerprint,
        status: commandAudit.status,
        session_id: commandAudit.sessionId,
        result_session_id: commandAudit.resultSessionId,
        create_selection: commandAudit.createSelection,
        create_expected_profile_version: commandAudit.createExpectedProfileVersion,
      })
      .from(commandAudit)
      .where(
        and(
          eq(commandAudit.ownerId, ownerId),
          eq(commandAudit.deviceId, deviceId),
          eq(commandAudit.commandId, commandId),
        ),
      );

    return row ?? null;
  }

  /** Records the accepted prompt that seeds a handoff's target. */
  async insertSeedCommand(
    tx: PoolClient,
    ownerId: string,
    commandId: string,
    deviceId: string,
    sessionId: string,
    fingerprint: string,
    now: number,
  ) {
    await ormOn(tx).insert(commandAudit).values({
      ownerId,
      commandId,
      deviceId,
      sessionId,
      action: CommandActionType.Prompt,
      fingerprint,
      status: CommandStatus.Accepted,
      createdAt: now,
    });
  }

  async setOperationPhase(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    id: string,
    expectedVersion: number,
    phase: string,
    code: string | null,
    targetExecutionId: string | null,
    now: number,
  ) {
    const updated = await ormOn(tx)
      .update(handoffOperations)
      .set({
        phase,
        code,
        targetExecutionId: sql`COALESCE(${targetExecutionId}::uuid,${handoffOperations.targetExecutionId})`,
        operationVersion: sql`${handoffOperations.operationVersion}+1`,
        updatedAt: now,
      })
      .where(and(operationOf(ownerId, deviceId, id), eq(handoffOperations.operationVersion, expectedVersion)))
      .returning({ id: handoffOperations.id });

    if (!updated.length) {
      throw new Fault(ContinuityError.VersionConflict);
    }

    return this.operation(tx, ownerId, deviceId, id);
  }
}
