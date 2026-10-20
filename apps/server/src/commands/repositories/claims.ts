import type { PoolClient } from 'pg';

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

/** Command id claims across relay commands and handoffs; every call runs in the caller's transaction. */
export class CommandClaimRepository {
  async lock(tx: PoolClient, commandId: string, seed: number) {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, $2))', [commandId, seed]);
  }

  /** Whether any of the ids is already claimed, audited or bound to a handoff. */
  async anyTaken(tx: PoolClient, commandIds: readonly string[]): Promise<boolean> {
    const existing = await tx.query(
      'SELECT command_id::text FROM command_id_claims WHERE command_id = ANY($1::uuid[]) UNION ALL SELECT command_id FROM command_audit WHERE command_id = ANY($2::text[]) UNION ALL SELECT command_id::text FROM handoff_command_ids WHERE command_id = ANY($1::uuid[])',
      [commandIds, commandIds],
    );

    return existing.rows.length > 0;
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
    await tx.query(
      'INSERT INTO command_id_claims(command_id,owner_id,device_id,operation_id,kind,fingerprint,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [commandId, ownerId, deviceId, operationId, kind, fingerprint, now],
    );
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
    await tx.query(
      'INSERT INTO command_id_claims(command_id,owner_id,device_id,operation_id,kind,fingerprint,created_at) VALUES($1,$2,$3,NULL,$4,$5,$6)',
      [commandId, ownerId, deviceId, kind, fingerprint, now],
    );
  }

  /** Locks the claim on a command id, whoever owns it. */
  async lockClaim(tx: PoolClient, commandId: string): Promise<CommandClaimRow | undefined> {
    return (
      await tx.query<CommandClaimRow>(
        'SELECT owner_id,device_id,operation_id,kind,fingerprint FROM command_id_claims WHERE command_id=$1 FOR UPDATE',
        [commandId],
      )
    ).rows[0];
  }

  /** Locks the claim on a handoff's create command id, whoever owns it. */
  async lockCreateClaim(tx: PoolClient, commandId: string) {
    return (
      await tx.query<{ owner_id: string; device_id: string; operation_id: string; kind: string }>(
        'SELECT owner_id,device_id,operation_id,kind FROM command_id_claims WHERE command_id=$1 FOR UPDATE',
        [commandId],
      )
    ).rows[0];
  }

  /** The audit row a command id already has, whoever owns it. */
  async audit(tx: PoolClient, commandId: string): Promise<CommandAuditOwnerRow | undefined> {
    return (
      await tx.query<CommandAuditOwnerRow>(
        'SELECT owner_id,device_id,fingerprint FROM command_audit WHERE command_id=$1',
        [commandId],
      )
    ).rows[0];
  }

  async lockAudit(tx: PoolClient, commandId: string): Promise<CommandAuditOwnerRow | undefined> {
    return (
      await tx.query<CommandAuditOwnerRow>(
        'SELECT owner_id,device_id,fingerprint FROM command_audit WHERE command_id=$1 FOR UPDATE',
        [commandId],
      )
    ).rows[0];
  }

  async lockHandoffOperation(tx: PoolClient, ownerId: string, deviceId: string, operationId: string) {
    return (
      await tx.query<{ create_command_id: string; phase: string }>(
        'SELECT create_command_id,phase FROM handoff_operations WHERE owner_id=$1 AND device_id=$2 AND id=$3 FOR UPDATE',
        [ownerId, deviceId, operationId],
      )
    ).rows[0];
  }
}
