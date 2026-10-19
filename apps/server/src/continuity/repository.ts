import type { PoolClient } from 'pg';
import { ConversationRepository } from './repositories/conversations.js';
import { HandoffRepository, type OperationState } from './repositories/handoffs.js';
import { SeedProofRepository, type SeedProofRecord } from './repositories/seed-proofs.js';
import type { PersistHandoffInput } from './types.js';

export class ContinuityRepository extends ConversationRepository {
  private readonly handoffs = new HandoffRepository();
  private readonly seedProofs = new SeedProofRepository();
  operation(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    id: string,
    lock?: boolean,
  ): Promise<OperationState> {
    return this.handoffs.operation(tx, ownerId, deviceId, id, lock);
  }
  findOperation(tx: PoolClient, ownerId: string, deviceId: string, id: string) {
    return this.handoffs.findOperation(tx, ownerId, deviceId, id);
  }
  insertOperation(tx: PoolClient, input: PersistHandoffInput, fingerprint: string, now: number) {
    return this.handoffs.insertOperation(tx, input, fingerprint, now);
  }
  activeOperation(tx: PoolClient, ownerId: string, deviceId: string, conversationId: string) {
    return this.handoffs.activeOperation(tx, ownerId, deviceId, conversationId);
  }
  pendingOperation(tx: PoolClient, ownerId: string, deviceId: string, conversationId: string) {
    return this.handoffs.pendingOperation(tx, ownerId, deviceId, conversationId);
  }
  command(tx: PoolClient, ownerId: string, deviceId: string, commandId: string) {
    return this.handoffs.command(tx, ownerId, deviceId, commandId);
  }
  seedClaim(tx: PoolClient, ownerId: string, deviceId: string, operationId: string, commandId: string) {
    return this.seedProofs.claimBelongsToOperation(tx, ownerId, deviceId, operationId, commandId);
  }
  seedProof(tx: PoolClient, ownerId: string, deviceId: string, operationId: string) {
    return this.seedProofs.get(tx, ownerId, deviceId, operationId);
  }
  insertSeedProof(
    tx: PoolClient,
    value: SeedProofRecord & {
      owner_id: string;
      device_id: string;
      conversation_id: string;
      operation_id: string;
      received_at: number;
    },
  ) {
    return this.seedProofs.insert(tx, value);
  }
  setOperationPhase(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    id: string,
    expected: number,
    phase: string,
    code: string | null,
    target: string | null,
    now: number,
  ) {
    return this.handoffs.setOperationPhase(tx, ownerId, deviceId, id, expected, phase, code, target, now);
  }
}
