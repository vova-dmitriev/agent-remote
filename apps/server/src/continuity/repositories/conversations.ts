import type { PoolClient } from 'pg';
import { executionLinkSchema, type Conversation } from '@protocol';
import { Fault } from '../../http/fault.js';
import { ContinuityError, type InitialExecution } from '../types.js';
import { asConversation, asExecution, type ContinuityRow } from './mapping.js';

export interface DeviceState {
  generation: string;
  snapshot: unknown;
}

export class ConversationRepository {
  async device(tx: PoolClient, ownerId: string, deviceId: string, generation: string): Promise<DeviceState> {
    const row = (
      await tx.query<{ generation: string; revoked_at: string | null; snapshot: unknown }>(
        'SELECT generation,revoked_at,snapshot FROM devices WHERE owner_id=$1 AND id=$2 FOR UPDATE',
        [ownerId, deviceId],
      )
    ).rows[0];

    if (!row || row.revoked_at !== null) {
      throw new Fault(ContinuityError.NotFound);
    }

    if (row.generation !== generation) {
      throw new Fault(ContinuityError.DeviceGenerationChanged);
    }

    return { generation: row.generation, snapshot: row.snapshot };
  }

  async conversation(tx: PoolClient, ownerId: string, deviceId: string, id: string, lock = false) {
    const row = (
      await tx.query<ContinuityRow>(
        `SELECT id,owner_id,device_id,active_execution_id,version,updated_at FROM continuity_conversations WHERE owner_id=$1 AND device_id=$2 AND id=$3${lock ? ' FOR UPDATE' : ''}`,
        [ownerId, deviceId, id],
      )
    ).rows[0];

    if (!row) {
      throw new Fault(ContinuityError.NotFound);
    }

    return asConversation(row);
  }

  async findConversation(tx: PoolClient, ownerId: string, deviceId: string, id: string, lock = false) {
    const row = (
      await tx.query<ContinuityRow>(
        `SELECT id,owner_id,device_id,active_execution_id,version,updated_at FROM continuity_conversations WHERE owner_id=$1 AND device_id=$2 AND id=$3${lock ? ' FOR UPDATE' : ''}`,
        [ownerId, deviceId, id],
      )
    ).rows[0];

    return row ? asConversation(row) : null;
  }

  async execution(tx: PoolClient, ownerId: string, deviceId: string, conversationId: string, id: string) {
    const row = (
      await tx.query<ContinuityRow>(
        'SELECT * FROM execution_links WHERE owner_id=$1 AND device_id=$2 AND conversation_id=$3 AND id=$4',
        [ownerId, deviceId, conversationId, id],
      )
    ).rows[0];

    if (!row) {
      throw new Fault(ContinuityError.NotFound);
    }

    return asExecution(row);
  }

  async executions(tx: PoolClient, ownerId: string, deviceId: string, conversationId: string) {
    const rows = await tx.query<ContinuityRow>(
      'SELECT * FROM execution_links WHERE owner_id=$1 AND device_id=$2 AND conversation_id=$3 ORDER BY created_at,id LIMIT 100',
      [ownerId, deviceId, conversationId],
    );

    return rows.rows.map(asExecution);
  }

  async executionForSession(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    nativeSessionId: string,
    generation: string,
  ) {
    const row = (
      await tx.query<ContinuityRow>(
        'SELECT * FROM execution_links WHERE owner_id=$1 AND device_id=$2 AND native_session_id=$3 AND generation=$4 LIMIT 1',
        [ownerId, deviceId, nativeSessionId, generation],
      )
    ).rows[0];

    return row ? asExecution(row) : null;
  }

  async insertConversation(tx: PoolClient, value: Conversation) {
    await tx.query(
      'INSERT INTO continuity_conversations(id,owner_id,device_id,active_execution_id,version,updated_at) VALUES($1,$2,$3,NULL,$4,$5)',
      [value.id, value.ownerId, value.deviceId, value.version, value.updatedAt],
    );
  }

  async insertExecution(
    tx: PoolClient,
    value: InitialExecution & { ownerId: string; deviceId: string },
    now: number,
  ) {
    const link = executionLinkSchema.parse({ ...value, createdAt: now });

    await tx.query(
      'INSERT INTO execution_links(id,conversation_id,owner_id,device_id,provider,profile_id,mode,native_session_id,generation,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        link.id,
        link.conversationId,
        link.ownerId,
        link.deviceId,
        link.provider,
        link.profileId,
        link.mode,
        link.nativeSessionId,
        link.generation,
        link.createdAt,
      ],
    );

    return link;
  }

  async setInitialExecution(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    conversationId: string,
    executionId: string,
  ) {
    await tx.query(
      'UPDATE continuity_conversations SET active_execution_id=$4 WHERE owner_id=$1 AND device_id=$2 AND id=$3',
      [ownerId, deviceId, conversationId, executionId],
    );
  }

  async setActiveExecution(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    conversationId: string,
    executionId: string,
    expectedVersion: number,
    now: number,
  ) {
    const result = await tx.query(
      'UPDATE continuity_conversations SET active_execution_id=$4,version=version+1,updated_at=$6 WHERE owner_id=$1 AND device_id=$2 AND id=$3 AND version=$5 RETURNING id,owner_id,device_id,active_execution_id,version,updated_at',
      [ownerId, deviceId, conversationId, executionId, expectedVersion, now],
    );

    if (!result.rowCount) {
      throw new Fault(ContinuityError.VersionConflict);
    }

    return asConversation(result.rows[0] as ContinuityRow);
  }

  async bumpConversation(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    id: string,
    expectedVersion: number,
    now: number,
  ) {
    const result = await tx.query(
      'UPDATE continuity_conversations SET version=version+1,updated_at=$5 WHERE owner_id=$1 AND device_id=$2 AND id=$3 AND version=$4 RETURNING id,owner_id,device_id,active_execution_id,version,updated_at',
      [ownerId, deviceId, id, expectedVersion, now],
    );

    if (!result.rowCount) {
      throw new Fault(ContinuityError.VersionConflict);
    }

    return asConversation(result.rows[0] as ContinuityRow);
  }
}
