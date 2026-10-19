import { conversationSchema } from '@protocol';
import { Fault } from '../../auth/security.js';
import type { Principal } from '../../auth/security.js';
import type { Database } from '../../db/database.js';
import { ContinuityRepository } from '../repository.js';
import { ContinuityError, type ContinuityReadScope, type InitialExecution } from '../types.js';
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

      const existing = await this.repository.findConversation(tx, principal.userId, scope.deviceId, id, true);

      if (existing) {
        const executions = await this.repository.executions(tx, principal.userId, scope.deviceId, id);

        const sameSource = executions.some(
          (link) =>
            link.nativeSessionId === input.nativeSessionId &&
            link.generation === input.generation &&
            link.provider === input.provider &&
            link.profileId === input.profileId &&
            link.mode === input.mode,
        );

        if (!sameSource) {
          throw new Fault(ContinuityError.ReplayConflict, 409);
        }

        return existing;
      }

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

  listLinks(principal: Principal, scope: ContinuityReadScope, id: string) {
    return this.database.transaction(async (tx) => {
      await this.repository.device(tx, principal.userId, scope.deviceId, scope.deviceGeneration);
      const conversationId = uuid.parse(id);

      const conversation = await this.repository.conversation(
        tx,
        principal.userId,
        scope.deviceId,
        conversationId,
      );

      const executions = await this.repository.executions(
        tx,
        principal.userId,
        scope.deviceId,
        conversationId,
      );

      const pendingHandoff = await this.repository.pendingOperation(
        tx,
        principal.userId,
        scope.deviceId,
        conversationId,
      );

      return { conversation, executions, pendingHandoff };
    });
  }

  inspectSource(principal: Principal, scope: ContinuityReadScope, sessionId: string, generation: string) {
    return this.database.transaction(async (tx) => {
      await this.repository.device(tx, principal.userId, scope.deviceId, scope.deviceGeneration);

      const sourceExecution = await this.repository.executionForSession(
        tx,
        principal.userId,
        scope.deviceId,
        sessionId,
        generation,
      );

      if (!sourceExecution) {
        return { conversation: null, sourceExecution: null, pendingHandoff: null };
      }

      const conversation = await this.repository.conversation(
        tx,
        principal.userId,
        scope.deviceId,
        sourceExecution.conversationId,
      );

      const pendingHandoff = await this.repository.pendingOperation(
        tx,
        principal.userId,
        scope.deviceId,
        conversation.id,
      );

      return { conversation, sourceExecution, pendingHandoff };
    });
  }
}
