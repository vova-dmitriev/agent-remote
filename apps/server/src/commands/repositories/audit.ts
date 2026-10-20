import {
  BindingState,
  CommandActionType,
  CommandStatus,
  ErrorCode,
  IntegrationState,
  type CommandResult,
} from '@protocol';
import type { PoolClient } from 'pg';
import type { Database } from '../../db/database.js';

export interface CommandAuditInput {
  ownerId: string;
  commandId: string;
  deviceId: string;
  sessionId: string;
  action: string;
  fingerprint: string;
  createdAt: number;
  status: CommandResult['status'];
  createSelection: unknown;
  createExpectedProfileVersion: unknown;
}

export interface CommandResultInput {
  ownerId: string;
  deviceId: string;
  commandId: string;
  status: string;
  code: string | null;
  sessionId: string | null;
}

/** The command audit: what each owner's commands were and how they ended. */
export class CommandRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  /** The public status of an owned command. */
  async status(ownerId: string, commandId: string) {
    return (
      await this.db.pool.query(
        'SELECT command_id AS "commandId",status,code,result_session_id AS "sessionId" FROM command_audit WHERE owner_id=$1 AND command_id=$2',
        [ownerId, commandId],
      )
    ).rows[0];
  }

  async find(ownerId: string, commandId: string) {
    return (
      await this.db.pool.query<{
        fingerprint: string;
        status: CommandResult['status'];
        code: string | null;
        result_session_id: string | null;
      }>(
        'SELECT fingerprint,status,code,result_session_id FROM command_audit WHERE owner_id=$1 AND command_id=$2',
        [ownerId, commandId],
      )
    ).rows[0];
  }

  /** The device of an owned handoff operation. */
  async handoffDevice(ownerId: string, operationId: string): Promise<string | undefined> {
    return (
      await this.db.pool.query<{ device_id: string }>(
        'SELECT device_id FROM handoff_operations WHERE owner_id=$1 AND id=$2',
        [ownerId, operationId],
      )
    ).rows[0]?.device_id;
  }

  /** Records a command once; returns whether this call recorded it. */
  async insert(tx: PoolClient, input: CommandAuditInput): Promise<boolean> {
    return Boolean(
      (
        await tx.query(
          'INSERT INTO command_audit(owner_id,command_id,device_id,session_id,action,fingerprint,status,created_at,create_selection,create_expected_profile_version) VALUES($1,$2,$3,$4,$5,$6,$8,$7,$9,$10) ON CONFLICT DO NOTHING RETURNING command_id',
          [
            input.ownerId,
            input.commandId,
            input.deviceId,
            input.sessionId,
            input.action,
            input.fingerprint,
            input.createdAt,
            input.status,
            input.createSelection,
            input.createExpectedProfileVersion,
          ],
        )
      ).rowCount,
    );
  }

  async setOutcome(ownerId: string, commandId: string, status: string, code: string) {
    await this.db.pool.query(
      'UPDATE command_audit SET status=$3,code=$4 WHERE owner_id=$1 AND command_id=$2',
      [ownerId, commandId, status, code],
    );
  }

  /** Whether a device's verified, ready session was created by one of its create or restart commands. */
  async createdSession(
    ownerId: string,
    deviceId: string,
    sessionId: string,
    commandId: string,
  ): Promise<boolean> {
    return Boolean(
      (
        await this.db.pool.query(
          "SELECT s.id FROM sessions s JOIN command_audit c ON c.owner_id=s.owner_id AND c.device_id=s.device_id WHERE s.owner_id=$1 AND s.device_id=$2 AND s.id=$3 AND c.command_id=$4 AND c.action IN ($5,$6) AND s.data->>'binding'=$7 AND s.data->>'integrationState'=$8",
          [
            ownerId,
            deviceId,
            sessionId,
            commandId,
            CommandActionType.CreateSession,
            CommandActionType.RestartSession,
            BindingState.Verified,
            IntegrationState.Ready,
          ],
        )
      ).rowCount,
    );
  }

  /** Records a device's result for one of its still accepted commands; returns whether it did. */
  async recordResult(input: CommandResultInput): Promise<boolean> {
    return Boolean(
      (
        await this.db.pool.query(
          'UPDATE command_audit SET status=$1,code=$2,result_session_id=$6 WHERE owner_id=$3 AND device_id=$4 AND command_id=$5 AND status=$7 RETURNING command_id',
          [
            input.status,
            input.code,
            input.ownerId,
            input.deviceId,
            input.commandId,
            input.sessionId,
            CommandStatus.Accepted,
          ],
        )
      ).rowCount,
    );
  }

  /** Marks every owner's commands accepted before `before` and never acknowledged as unknown. */
  async expireUnacknowledged(before: number) {
    await this.db.pool.query('UPDATE command_audit SET status=$2,code=$3 WHERE status=$4 AND created_at<$1', [
      before,
      CommandStatus.Unknown,
      ErrorCode.ACK_TIMEOUT,
      CommandStatus.Accepted,
    ]);
  }

  /** Drops up to `limit` of every owner's commands created before `before`; returns how many. */
  async pruneBatch(before: number, limit: number): Promise<number> {
    return (
      (
        await this.db.pool.query(
          'DELETE FROM command_audit WHERE ctid IN (SELECT ctid FROM command_audit WHERE created_at<$1 LIMIT $2)',
          [before, limit],
        )
      ).rowCount ?? 0
    );
  }
}
