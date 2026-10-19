import { randomUUID } from 'node:crypto';
import { startHandoffRequestSchema, type HandoffOperation } from '@protocol';
import { type Principal } from '../../auth/security.js';
import { Fault } from '../../http/fault.js';
import type { Database } from '../../db/database.js';
import { ContinuityRepository } from '../repository.js';
import { ContinuityError, type ContinuityReadScope, type StartHandoffInput } from '../types.js';
import { CommandClaimKind, reserveHandoffCommandIds } from '../command-claims.js';
import { fingerprint, uuid } from './values.js';

export class HandoffContinuityService {
  private readonly repository = new ContinuityRepository();
  constructor(
    private readonly database: Database,
    private readonly now = Date.now,
  ) {}

  async start(
    principal: Principal,
    scope: ContinuityReadScope,
    raw: StartHandoffInput,
  ): Promise<HandoffOperation> {
    const input = startHandoffRequestSchema.parse(raw);
    const request = input.request;

    if (request.ownerId !== principal.userId || request.deviceId !== scope.deviceId) {
      throw new Fault(ContinuityError.NotFound);
    }

    const requestFingerprint = fingerprint(input);

    try {
      return await this.database.transaction(async (tx) => {
        await this.repository.device(tx, principal.userId, scope.deviceId, scope.deviceGeneration);

        const prior = await this.repository.findOperation(
          tx,
          principal.userId,
          request.deviceId,
          input.operationId,
        );

        if (prior) {
          if (prior.fingerprint !== requestFingerprint) {
            throw new Fault(ContinuityError.ReplayConflict);
          }

          return prior.value;
        }

        const conversation = await this.repository.conversation(
          tx,
          principal.userId,
          request.deviceId,
          request.conversationId,
          true,
        );

        if (conversation.version !== request.expectedConversationVersion) {
          throw new Fault(ContinuityError.VersionConflict);
        }

        if (conversation.activeExecutionId !== request.sourceExecutionId) {
          throw new Fault(ContinuityError.SourceNotActive);
        }

        const source = await this.repository.execution(
          tx,
          principal.userId,
          request.deviceId,
          request.conversationId,
          request.sourceExecutionId,
        );

        if (source.generation !== request.sourceGeneration) {
          throw new Fault(ContinuityError.SourceNotActive);
        }

        if (
          await this.repository.activeOperation(
            tx,
            principal.userId,
            request.deviceId,
            request.conversationId,
          )
        ) {
          throw new Fault(ContinuityError.OperationActive);
        }

        const now = this.now();

        const createCommandId = randomUUID();
        const seedCommandId = randomUUID();
        const persisted = { ...input, createCommandId, seedCommandId };

        await reserveHandoffCommandIds(
          tx,
          principal.userId,
          scope.deviceId,
          [
            {
              id: input.operationId,
              kind: CommandClaimKind.HandoffOperation,
              operationId: input.operationId,
            },
            {
              id: createCommandId,
              kind: CommandClaimKind.HandoffCreate,
              operationId: input.operationId,
            },
            {
              id: seedCommandId,
              kind: CommandClaimKind.HandoffSeed,
              operationId: input.operationId,
            },
          ],
          requestFingerprint,
          now,
        );

        await this.repository.insertOperation(tx, persisted, requestFingerprint, now);

        await this.repository.bumpConversation(
          tx,
          principal.userId,
          request.deviceId,
          request.conversationId,
          conversation.version,
          now,
        );

        return (await this.repository.operation(tx, principal.userId, request.deviceId, input.operationId))
          .value;
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new Fault(ContinuityError.ReplayConflict);
      }

      throw error;
    }
  }

  get(principal: Principal, scope: ContinuityReadScope, id: string) {
    return this.database.transaction(async (tx) => {
      await this.repository.device(tx, principal.userId, scope.deviceId, scope.deviceGeneration);

      return (await this.repository.operation(tx, principal.userId, scope.deviceId, uuid.parse(id))).value;
    });
  }
}
