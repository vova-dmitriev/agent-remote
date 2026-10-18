import type { PoolClient } from 'pg';
import { CommandClaimKind } from '../command-claims.js';

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

export class SeedProofRepository {
  async claimBelongsToOperation(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    operationId: string,
    commandId: string,
  ) {
    const row = (
      await tx.query<{ kind: string; operation_id: string | null }>(
        'SELECT kind,operation_id FROM command_id_claims WHERE owner_id=$1 AND device_id=$2 AND command_id=$3',
        [ownerId, deviceId, commandId],
      )
    ).rows[0];

    return row?.kind === CommandClaimKind.HandoffSeed && row.operation_id === operationId;
  }

  async get(tx: PoolClient, ownerId: string, deviceId: string, operationId: string) {
    return (
      (
        await tx.query<SeedProofRecord>(
          'SELECT device_generation,seed_command_id,checkpoint_id,checkpoint_digest,target_execution_id,target_generation,target_profile_id,target_provider,target_model,target_effort FROM handoff_seed_proofs WHERE owner_id=$1 AND device_id=$2 AND operation_id=$3',
          [ownerId, deviceId, operationId],
        )
      ).rows[0] ?? null
    );
  }

  async insert(tx: PoolClient, proof: StoredSeedProof) {
    await tx.query(
      'INSERT INTO handoff_seed_proofs(operation_id,owner_id,device_id,conversation_id,device_generation,seed_command_id,checkpoint_id,checkpoint_digest,target_execution_id,target_generation,target_profile_id,target_provider,target_model,target_effort,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
      [
        proof.operation_id,
        proof.owner_id,
        proof.device_id,
        proof.conversation_id,
        proof.device_generation,
        proof.seed_command_id,
        proof.checkpoint_id,
        proof.checkpoint_digest,
        proof.target_execution_id,
        proof.target_generation,
        proof.target_profile_id,
        proof.target_provider,
        proof.target_model,
        proof.target_effort,
        proof.received_at,
      ],
    );
  }
}
