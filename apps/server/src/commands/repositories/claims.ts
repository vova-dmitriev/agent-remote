import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { ormOn } from '../../db/database.js';
import {
  commandAudit,
  commandIdClaims,
  handoffCommandIds,
  handoffOperations,
} from '../../db/schema/index.js';

export interface CommandClaimRow {
  owner_id: string;
  device_id: string;
  operation_id: string | null;
  kind: string;
  fingerprint: string;
}

export interface CommandAuditOwnerRow {
  owner_id: string;
  device_id: string;
  fingerprint: string;
}

const claimColumns = {
  owner_id: commandIdClaims.ownerId,
  device_id: commandIdClaims.deviceId,
  operation_id: commandIdClaims.operationId,
  kind: commandIdClaims.kind,
};

const auditColumns = {
  owner_id: commandAudit.ownerId,
  device_id: commandAudit.deviceId,
  fingerprint: commandAudit.fingerprint,
};

/** Command id claims across relay commands and handoffs; every call runs in the caller's transaction. */
export class CommandClaimRepository {
  async lock(tx: PoolClient, commandId: string, seed: number) {
    await ormOn(tx).execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${commandId}, ${seed}))`);
  }

  /** Whether any of the ids is already claimed, audited or bound to a handoff. */
  async anyTaken(tx: PoolClient, commandIds: readonly string[]): Promise<boolean> {
    const orm = ormOn(tx);
    const ids = [...commandIds];

    const existing = await orm
      .select({ id: sql<string>`${commandIdClaims.commandId}::text` })
      .from(commandIdClaims)
      .where(inArray(commandIdClaims.commandId, ids))
      .unionAll(
        orm
          .select({ id: commandAudit.commandId })
          .from(commandAudit)
          .where(inArray(commandAudit.commandId, ids)),
      )
      .unionAll(
        orm
          .select({ id: sql<string>`${handoffCommandIds.commandId}::text` })
          .from(handoffCommandIds)
          .where(inArray(handoffCommandIds.commandId, ids)),
      );

    return existing.length > 0;
  }

  async insert(
    tx: PoolClient,
    commandId: string,
    ownerId: string,
    deviceId: string,
    operationId: string,
    kind: string,
    fingerprint: string,
    now: number,
  ) {
    await ormOn(tx)
      .insert(commandIdClaims)
      .values({ commandId, ownerId, deviceId, operationId, kind, fingerprint, createdAt: now });
  }

  async insertWithoutOperation(
    tx: PoolClient,
    commandId: string,
    ownerId: string,
    deviceId: string,
    kind: string,
    fingerprint: string,
    now: number,
  ) {
    await ormOn(tx)
      .insert(commandIdClaims)
      .values({ commandId, ownerId, deviceId, operationId: null, kind, fingerprint, createdAt: now });
  }

  /** Locks the claim on a command id, whoever owns it. */
  async lockClaim(tx: PoolClient, commandId: string): Promise<CommandClaimRow | undefined> {
    const [row] = await ormOn(tx)
      .select({ ...claimColumns, fingerprint: commandIdClaims.fingerprint })
      .from(commandIdClaims)
      .where(eq(commandIdClaims.commandId, commandId))
      .for('update');

    return row;
  }

  /** Locks the claim on a handoff's create command id, whoever owns it. */
  async lockCreateClaim(tx: PoolClient, commandId: string) {
    const [row] = await ormOn(tx)
      .select({ ...claimColumns, operation_id: sql<string>`${commandIdClaims.operationId}` })
      .from(commandIdClaims)
      .where(eq(commandIdClaims.commandId, commandId))
      .for('update');

    return row;
  }

  /** The audit row a command id already has, whoever owns it. */
  async audit(tx: PoolClient, commandId: string): Promise<CommandAuditOwnerRow | undefined> {
    const [row] = await ormOn(tx)
      .select(auditColumns)
      .from(commandAudit)
      .where(eq(commandAudit.commandId, commandId));

    return row;
  }

  async lockAudit(tx: PoolClient, commandId: string): Promise<CommandAuditOwnerRow | undefined> {
    const [row] = await ormOn(tx)
      .select(auditColumns)
      .from(commandAudit)
      .where(eq(commandAudit.commandId, commandId))
      .for('update');

    return row;
  }

  async lockHandoffOperation(tx: PoolClient, ownerId: string, deviceId: string, operationId: string) {
    const [row] = await ormOn(tx)
      .select({ create_command_id: handoffOperations.createCommandId, phase: handoffOperations.phase })
      .from(handoffOperations)
      .where(
        and(
          eq(handoffOperations.ownerId, ownerId),
          eq(handoffOperations.deviceId, deviceId),
          eq(handoffOperations.id, operationId),
        ),
      )
      .for('update');

    return row;
  }
}
