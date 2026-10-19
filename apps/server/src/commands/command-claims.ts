import type { PoolClient } from 'pg';
import { ErrorCode, HandoffPhase } from '@protocol';
import { Fault } from '../http/errors/fault.js';
import { ContinuityError } from '../continuity/types.js';
import { CommandClaimRepository } from './repositories/claims.js';

export const CommandClaimKind = {
  Command: 'command',
  HandoffOperation: 'handoff_operation',
  HandoffCreate: 'handoff_create',
  HandoffSeed: 'handoff_seed',
} as const;
export type CommandClaimKind = (typeof CommandClaimKind)[keyof typeof CommandClaimKind];

export const CommandClaimTime = { AdvisoryLockSeed: 0 } as const;

const claims = new CommandClaimRepository();

async function lockCommandIds(tx: PoolClient, ids: readonly string[]) {
  for (const commandId of [...ids].sort()) {
    await claims.lock(tx, commandId, CommandClaimTime.AdvisoryLockSeed);
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

  if (await claims.anyTaken(tx, commandIds)) {
    throw new Fault(ContinuityError.CommandIdReserved);
  }

  for (const entry of ids) {
    await claims.insert(tx, entry.id, ownerId, deviceId, entry.operationId, entry.kind, fingerprint, now);
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

  const claim = await claims.lockClaim(tx, commandId);

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

  const oldAudit = await claims.audit(tx, commandId);

  if (oldAudit) {
    if (oldAudit.owner_id !== ownerId || oldAudit.device_id !== deviceId) {
      throw new Fault(ContinuityError.CommandIdReserved);
    }

    if (oldAudit.fingerprint !== fingerprint) {
      throw new Fault(ErrorCode.COMMAND_ID_REUSED);
    }

    await claims.insertWithoutOperation(
      tx,
      commandId,
      ownerId,
      deviceId,
      CommandClaimKind.Command,
      fingerprint,
      now,
    );

    return false;
  }

  await claims.insertWithoutOperation(
    tx,
    commandId,
    ownerId,
    deviceId,
    CommandClaimKind.Command,
    fingerprint,
    now,
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

  const operation = await claims.lockHandoffOperation(tx, ownerId, deviceId, operationId);
  const claim = await claims.lockCreateClaim(tx, commandId);

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

  const oldAudit = await claims.lockAudit(tx, commandId);

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
