import type { PoolClient } from 'pg';
import { HandoffPhase, type HandoffOperation } from '@protocol';
import { Fault } from '../../http/errors/fault.js';
import { ContinuityError, HandoffCommandKind, type PersistHandoffInput } from '../types.js';
import { asOperation, type ContinuityRow } from './mapping.js';

export interface OperationState {
  value: HandoffOperation;
  version: number;
  fingerprint: string;
}
export class HandoffRepository {
  async operation(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    id: string,
    lock = false,
  ): Promise<OperationState> {
    const row = (
      await tx.query<ContinuityRow>(
        `SELECT * FROM handoff_operations WHERE owner_id=$1 AND device_id=$2 AND id=$3${lock ? ' FOR UPDATE' : ''}`,
        [ownerId, deviceId, id],
      )
    ).rows[0];

    if (!row) {
      throw new Fault(ContinuityError.NotFound);
    }

    return {
      value: asOperation(row),
      version: Number(row.operation_version),
      fingerprint: String(row.request_fingerprint).trim(),
    };
  }

  async findOperation(tx: PoolClient, ownerId: string, deviceId: string, id: string) {
    const row = (
      await tx.query<ContinuityRow>(
        'SELECT * FROM handoff_operations WHERE owner_id=$1 AND device_id=$2 AND id=$3',
        [ownerId, deviceId, id],
      )
    ).rows[0];

    return row
      ? {
          value: asOperation(row),
          version: Number(row.operation_version),
          fingerprint: String(row.request_fingerprint).trim(),
        }
      : null;
  }

  async insertOperation(tx: PoolClient, input: PersistHandoffInput, fingerprint: string, now: number) {
    const request = input.request;

    await tx.query(
      'INSERT INTO handoff_operations(id,owner_id,device_id,conversation_id,source_execution_id,source_generation,checkpoint_id,checkpoint_digest,expected_conversation_version,expected_profile_version,target_provider,target_profile_id,target_model,target_effort,phase,create_command_id,seed_command_id,request_fingerprint,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)',
      [
        input.operationId,
        request.ownerId,
        request.deviceId,
        request.conversationId,
        request.sourceExecutionId,
        request.sourceGeneration,
        request.checkpointId,
        request.checkpointDigest,
        request.expectedConversationVersion,
        request.expectedProfileVersion,
        request.selection.provider,
        request.selection.profileId,
        request.selection.model,
        request.selection.effort ?? null,
        HandoffPhase.CreatingTarget,
        input.createCommandId,
        input.seedCommandId,
        fingerprint,
        now,
      ],
    );

    await tx.query(
      'INSERT INTO handoff_command_ids(command_id,owner_id,device_id,operation_id,kind) VALUES($1,$2,$3,$4,$5),($6,$2,$3,$4,$7),($4,$2,$3,$4,$8)',
      [
        input.createCommandId,
        request.ownerId,
        request.deviceId,
        input.operationId,
        HandoffCommandKind.Create,
        input.seedCommandId,
        HandoffCommandKind.Seed,
        HandoffCommandKind.Operation,
      ],
    );
  }

  async activeOperation(tx: PoolClient, ownerId: string, deviceId: string, conversationId: string) {
    const result = await tx.query(
      "SELECT id FROM handoff_operations WHERE owner_id=$1 AND device_id=$2 AND conversation_id=$3 AND phase NOT IN ('ready','failed') LIMIT 1",
      [ownerId, deviceId, conversationId],
    );

    return result.rows.length > 0;
  }

  async pendingOperation(tx: PoolClient, ownerId: string, deviceId: string, conversationId: string) {
    const row = (
      await tx.query<ContinuityRow>(
        "SELECT * FROM handoff_operations WHERE owner_id=$1 AND device_id=$2 AND conversation_id=$3 AND phase NOT IN ('ready','failed') ORDER BY updated_at DESC LIMIT 1",
        [ownerId, deviceId, conversationId],
      )
    ).rows[0];

    return row ? asOperation(row) : null;
  }

  async command(tx: PoolClient, ownerId: string, deviceId: string, commandId: string) {
    return (
      (
        await tx.query<{
          action: string;
          fingerprint: string;
          status: string;
          session_id: string;
          result_session_id: string | null;
          create_selection: unknown;
          create_expected_profile_version: number | null;
        }>(
          'SELECT action,fingerprint,status,session_id,result_session_id,create_selection,create_expected_profile_version FROM command_audit WHERE owner_id=$1 AND device_id=$2 AND command_id=$3',
          [ownerId, deviceId, commandId],
        )
      ).rows[0] ?? null
    );
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
    const updated = await tx.query(
      'UPDATE handoff_operations SET phase=$5,code=$6,target_execution_id=COALESCE($7,target_execution_id),operation_version=operation_version+1,updated_at=$8 WHERE owner_id=$1 AND device_id=$2 AND id=$3 AND operation_version=$4 RETURNING id',
      [ownerId, deviceId, id, expectedVersion, phase, code, targetExecutionId, now],
    );

    if (!updated.rowCount) {
      throw new Fault(ContinuityError.VersionConflict);
    }

    return this.operation(tx, ownerId, deviceId, id);
  }
}
