import { and, eq } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { CommandClaimKind } from '../../commands/command-claims.js';
import { ormOn } from '../../db/database.js';
import { commandIdClaims, handoffSeedProofs } from '../../db/schema/index.js';

export interface SeedProofRecord {
  device_generation: string;
  seed_command_id: string;
  checkpoint_id: string;
  checkpoint_digest: string;
  target_execution_id: string;
  target_generation: string;
  target_profile_id: string;
  target_provider: string;
  target_model: string;
  target_effort: string | null;
}

type StoredSeedProof = SeedProofRecord & {
  owner_id: string;
  device_id: string;
  conversation_id: string;
  operation_id: string;
  received_at: number;
};

const record = {
  device_generation: handoffSeedProofs.deviceGeneration,
  seed_command_id: handoffSeedProofs.seedCommandId,
  checkpoint_id: handoffSeedProofs.checkpointId,
  checkpoint_digest: handoffSeedProofs.checkpointDigest,
  target_execution_id: handoffSeedProofs.targetExecutionId,
  target_generation: handoffSeedProofs.targetGeneration,
  target_profile_id: handoffSeedProofs.targetProfileId,
  target_provider: handoffSeedProofs.targetProvider,
  target_model: handoffSeedProofs.targetModel,
  target_effort: handoffSeedProofs.targetEffort,
};

export class SeedProofRepository {
  async claimBelongsToOperation(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    operationId: string,
    commandId: string,
  ) {
    const [row] = await ormOn(tx)
      .select({ kind: commandIdClaims.kind, operation_id: commandIdClaims.operationId })
      .from(commandIdClaims)
      .where(
        and(
          eq(commandIdClaims.ownerId, ownerId),
          eq(commandIdClaims.deviceId, deviceId),
          eq(commandIdClaims.commandId, commandId),
        ),
      );

    return row?.kind === CommandClaimKind.HandoffSeed && row.operation_id === operationId;
  }

  async get(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    operationId: string,
  ): Promise<SeedProofRecord | null> {
    const [row] = await ormOn(tx)
      .select(record)
      .from(handoffSeedProofs)
      .where(
        and(
          eq(handoffSeedProofs.ownerId, ownerId),
          eq(handoffSeedProofs.deviceId, deviceId),
          eq(handoffSeedProofs.operationId, operationId),
        ),
      );

    return row ?? null;
  }

  async insert(tx: PoolClient, proof: StoredSeedProof) {
    await ormOn(tx).insert(handoffSeedProofs).values({
      operationId: proof.operation_id,
      ownerId: proof.owner_id,
      deviceId: proof.device_id,
      conversationId: proof.conversation_id,
      deviceGeneration: proof.device_generation,
      seedCommandId: proof.seed_command_id,
      checkpointId: proof.checkpoint_id,
      checkpointDigest: proof.checkpoint_digest,
      targetExecutionId: proof.target_execution_id,
      targetGeneration: proof.target_generation,
      targetProfileId: proof.target_profile_id,
      targetProvider: proof.target_provider,
      targetModel: proof.target_model,
      targetEffort: proof.target_effort,
      receivedAt: proof.received_at,
    });
  }
}
