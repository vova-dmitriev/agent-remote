import { conversationSchema } from '../../../../../packages/protocol/src/index.js';
import type { Principal } from '../../auth/security.js';
import type { Database } from '../../db/database.js';
import { ContinuityRepository } from '../repository.js';
import type { ContinuityReadScope, InitialExecution } from '../types.js';
import { uuid } from './values.js';

export class ConversationContinuityService {
  private readonly repository = new ContinuityRepository();
  constructor(
    private readonly database: Database,
    private readonly now = Date.now,
  ) {}

  async create(principal: Principal, scope: ContinuityReadScope, input: InitialExecution) {
    const id = uuid.parse(input.conversationId);
    const now = this.now();

    const conversation = conversationSchema.parse({
      id,
      ownerId: principal.userId,
      deviceId: scope.deviceId,
      activeExecutionId: null,
      version: 1,
      updatedAt: now,
    });

    return this.database.transaction(async (tx) => {
      await this.repository.device(tx, principal.userId, scope.deviceId, scope.deviceGeneration);
      await this.repository.insertConversation(tx, conversation);

      const link = await this.repository.insertExecution(
        tx,
        { ...input, ownerId: principal.userId, deviceId: scope.deviceId },
        now,
      );

      await this.repository.setInitialExecution(tx, principal.userId, scope.deviceId, id, link.id);

      return conversationSchema.parse({ ...conversation, activeExecutionId: link.id });
    });
  }

  get(principal: Principal, scope: ContinuityReadScope, id: string) {
    return this.database.transaction(async (tx) => {
      await this.repository.device(tx, principal.userId, scope.deviceId, scope.deviceGeneration);

      return this.repository.conversation(tx, principal.userId, scope.deviceId, uuid.parse(id));
    });
  }

  getExecution(
    principal: Principal,
    scope: ContinuityReadScope,
    conversationId: string,
    executionId: string,
  ) {
    return this.database.transaction(async (tx) => {
      await this.repository.device(tx, principal.userId, scope.deviceId, scope.deviceGeneration);

      return this.repository.execution(
        tx,
        principal.userId,
        scope.deviceId,
        uuid.parse(conversationId),
        uuid.parse(executionId),
      );
    });
  }
}
