import type {
  ErrorCode,
  HandoffOperation,
  HandoffSeedProofFrame,
} from '../../../../packages/protocol/src/index.js';
import type { Principal } from '../auth/security.js';
import type { Database } from '../db/database.js';
import type {
  ContinuityReadScope,
  HandoffUnsuccessfulPhase,
  InitialExecution,
  StartHandoffInput,
} from './types.js';
import { ConversationContinuityService } from './services/conversations.js';
import { HandoffContinuityService } from './services/handoffs.js';
import { ExecutionActivationService } from './services/activation.js';
import { HandoffTransitionService } from './services/transitions.js';
import { AuthenticatedSeedProofService } from './services/seed-proof.js';

export class ContinuityService {
  private readonly conversations: ConversationContinuityService;
  private readonly handoffs: HandoffContinuityService;
  private readonly transitions: HandoffTransitionService;
  private readonly activation: ExecutionActivationService;
  private readonly seedProof: AuthenticatedSeedProofService;

  constructor(database: Database, now = Date.now) {
    this.conversations = new ConversationContinuityService(database, now);
    this.handoffs = new HandoffContinuityService(database, now);
    this.transitions = new HandoffTransitionService(database, now);
    this.activation = new ExecutionActivationService(database, now);
    this.seedProof = new AuthenticatedSeedProofService(database, now);
  }

  createConversation(principal: Principal, scope: ContinuityReadScope, input: InitialExecution) {
    return this.conversations.create(principal, scope, input);
  }
  getConversation(principal: Principal, scope: ContinuityReadScope, id: string) {
    return this.conversations.get(principal, scope, id);
  }
  getExecution(
    principal: Principal,
    scope: ContinuityReadScope,
    conversationId: string,
    executionId: string,
  ) {
    return this.conversations.getExecution(principal, scope, conversationId, executionId);
  }
  startHandoff(
    principal: Principal,
    scope: ContinuityReadScope,
    input: StartHandoffInput,
  ): Promise<HandoffOperation> {
    return this.handoffs.start(principal, scope, input);
  }
  getHandoff(principal: Principal, scope: ContinuityReadScope, id: string) {
    return this.handoffs.get(principal, scope, id);
  }
  recordAuthenticatedSeedProof(
    principal: Principal,
    scope: ContinuityReadScope,
    proof: HandoffSeedProofFrame,
  ) {
    return this.seedProof.record(principal, scope, proof);
  }
  recordCreatedTarget(
    principal: Principal,
    scope: ContinuityReadScope,
    operationId: string,
    expectedVersion: number,
    input: InitialExecution,
  ) {
    return this.transitions.recordCreatedTarget(principal, scope, operationId, expectedVersion, input);
  }
  activateExecution(
    principal: Principal,
    scope: ContinuityReadScope,
    conversationId: string,
    operationId: string,
    expectedConversationVersion: number,
    expectedOperationVersion: number,
  ) {
    return this.activation.activate(
      principal,
      scope,
      conversationId,
      operationId,
      expectedConversationVersion,
      expectedOperationVersion,
    );
  }
  setTerminal(
    principal: Principal,
    scope: ContinuityReadScope,
    operationId: string,
    expectedVersion: number,
    phase: HandoffUnsuccessfulPhase,
    code?: ErrorCode,
  ) {
    return this.transitions.setTerminal(principal, scope, operationId, expectedVersion, phase, code);
  }
}
