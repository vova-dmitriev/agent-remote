import type { PoolClient } from 'pg';
import { ErrorCode, HandoffPhase } from '@protocol';
import { Fault } from '../http/errors/fault.js';
import { ContinuityError } from './types.js';

export const CommandClaimKind = {
  Command: 'command',
  HandoffOperation: 'handoff_operation',
  HandoffCreate: 'handoff_create',
  HandoffSeed: 'handoff_seed',
} as const;
export type CommandClaimKind = (typeof CommandClaimKind)[keyof typeof CommandClaimKind];

export const CommandClaimTime = { AdvisoryLockSeed: 0 } as const;

async function lockCommandIds(tx: PoolClient, ids: readonly string[]) {
  for (const commandId of [...ids].sort()) {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, $2))', [
      commandId,
      CommandClaimTime.AdvisoryLockSeed,
    ]);
  }
}

export async function reserveHandoffCommandIds(
  tx: PoolClient,
  ownerId: string,
  deviceId: string,
  ids: readonly { id: string; kind: CommandClaimKind; operationId: string }[],
  fingerprint: string,
  now: number,
) {
  await lockCommandIds(
    tx,
    ids.map((entry) => entry.id),
  );

  const commandIds = ids.map((entry) => entry.id);

  const existing = await tx.query(
    'SELECT command_id::text FROM command_id_claims WHERE command_id = ANY($1::uuid[]) UNION ALL SELECT command_id FROM command_audit WHERE command_id = ANY($2::text[]) UNION ALL SELECT command_id::text FROM handoff_command_ids WHERE command_id = ANY($1::uuid[])',
    [commandIds, commandIds],
  );

  if (existing.rows.length) {
    throw new Fault(ContinuityError.CommandIdReserved);
  }

  for (const entry of ids) {
    await tx.query(
      'INSERT INTO command_id_claims(command_id,owner_id,device_id,operation_id,kind,fingerprint,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [entry.id, ownerId, deviceId, entry.operationId, entry.kind, fingerprint, now],
    );
  }
}

export async function claimRelayCommandId(
  tx: PoolClient,
  ownerId: string,
  deviceId: string,
  commandId: string,
  fingerprint: string,
  now: number,
): Promise<boolean> {
  await lockCommandIds(tx, [commandId]);

  const claim = (
    await tx.query<{
      owner_id: string;
      device_id: string;
      operation_id: string | null;
      kind: string;
      fingerprint: string;
    }>(
      'SELECT owner_id,device_id,operation_id,kind,fingerprint FROM command_id_claims WHERE command_id=$1 FOR UPDATE',
      [commandId],
    )
  ).rows[0];

  if (claim) {
    if (
      claim.owner_id !== ownerId ||
      claim.device_id !== deviceId ||
      claim.kind !== CommandClaimKind.Command
    ) {
      throw new Fault(ContinuityError.CommandIdReserved);
    }

    if (claim.fingerprint !== fingerprint) {
      throw new Fault(ErrorCode.COMMAND_ID_REUSED);
    }

    return false;
  }

  const oldAudit = (
    await tx.query<{ owner_id: string; device_id: string; fingerprint: string }>(
      'SELECT owner_id,device_id,fingerprint FROM command_audit WHERE command_id=$1',
      [commandId],
    )
  ).rows[0];

  if (oldAudit) {
    if (oldAudit.owner_id !== ownerId || oldAudit.device_id !== deviceId) {
      throw new Fault(ContinuityError.CommandIdReserved);
    }

    if (oldAudit.fingerprint !== fingerprint) {
      throw new Fault(ErrorCode.COMMAND_ID_REUSED);
    }

    await tx.query(
      'INSERT INTO command_id_claims(command_id,owner_id,device_id,operation_id,kind,fingerprint,created_at) VALUES($1,$2,$3,NULL,$4,$5,$6)',
      [commandId, ownerId, deviceId, CommandClaimKind.Command, fingerprint, now],
    );

    return false;
  }

  await tx.query(
    'INSERT INTO command_id_claims(command_id,owner_id,device_id,operation_id,kind,fingerprint,created_at) VALUES($1,$2,$3,NULL,$4,$5,$6)',
    [commandId, ownerId, deviceId, CommandClaimKind.Command, fingerprint, now],
  );

  return true;
}

export async function claimHandoffCreateCommandId(
  tx: PoolClient,
  ownerId: string,
  deviceId: string,
  commandId: string,
  operationId: string,
  fingerprint: string,
  now: number,
) {
  await lockCommandIds(tx, [commandId]);

  const operation = (
    await tx.query<{ create_command_id: string; phase: string }>(
      'SELECT create_command_id,phase FROM handoff_operations WHERE owner_id=$1 AND device_id=$2 AND id=$3 FOR UPDATE',
      [ownerId, deviceId, operationId],
    )
  ).rows[0];

  const claim = (
    await tx.query<{ owner_id: string; device_id: string; operation_id: string; kind: string }>(
      'SELECT owner_id,device_id,operation_id,kind FROM command_id_claims WHERE command_id=$1 FOR UPDATE',
      [commandId],
    )
  ).rows[0];

  if (
    !operation ||
    operation.phase !== HandoffPhase.CreatingTarget ||
    operation.create_command_id !== commandId ||
    !claim ||
    claim.owner_id !== ownerId ||
    claim.device_id !== deviceId ||
    claim.operation_id !== operationId ||
    claim.kind !== CommandClaimKind.HandoffCreate
  ) {
    throw new Fault(ContinuityError.CommandIdReserved);
  }

  const oldAudit = (
    await tx.query<{ owner_id: string; device_id: string; fingerprint: string }>(
      'SELECT owner_id,device_id,fingerprint FROM command_audit WHERE command_id=$1 FOR UPDATE',
      [commandId],
    )
  ).rows[0];

  if (oldAudit) {
    if (oldAudit.owner_id !== ownerId || oldAudit.device_id !== deviceId) {
      throw new Fault(ContinuityError.CommandIdReserved);
    }

    if (oldAudit.fingerprint !== fingerprint) {
      throw new Fault(ErrorCode.COMMAND_ID_REUSED);
    }

    return false;
  }

  if (!Number.isSafeInteger(now)) {
    throw new Fault(ErrorCode.INVALID_REQUEST);
  }

  return true;
}
