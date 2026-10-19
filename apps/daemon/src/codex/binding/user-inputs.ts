import {
  BindingState,
  CodedError,
  ErrorCode,
  IntegrationState,
  type Session,
  SessionStatus,
  userInputQuestionSchema,
} from '@protocol';
import { CodexMethod } from '../../domain/codex/codex.js';
import { randomUUID } from 'node:crypto';
import { type UserInputBroker } from '../../commands/user-input-broker.js';
import type { CodexClient, RpcFrame } from '../../domain/codex/client.js';
import { object } from '../events.js';

export class CodexUserInputs {
  private readonly requests = new Map<string | number, string>();
  constructor(
    private rpc: CodexClient,
    private session: Session,
    private broker: UserInputBroker | undefined,
    private currentTurn: () => string | null,
    private changed: () => void,
  ) {}
  request(frame: RpcFrame): void {
    const params = object(frame.params),
      id = frame.id;

    if (
      frame.method !== CodexMethod.ItemToolRequestUserInput ||
      id === undefined ||
      !this.broker ||
      !this.session.capabilities.userInput ||
      params.threadId !== ('threadId' in this.session.target ? this.session.target.threadId : null) ||
      params.turnId !== this.currentTurn() ||
      typeof params.itemId !== 'string' ||
      this.requests.has(id)
    ) {
      return;
    }

    const parsed = userInputQuestionSchema.array().min(1).max(3).safeParse(params.questions);

    if (!parsed.success || new Set(parsed.data.map((question) => question.id)).size !== parsed.data.length) {
      return;
    }

    const requestId = randomUUID(),
      turnId = this.currentTurn()!,
      generation = this.session.generation;

    this.requests.set(id, requestId);
    const isBlocking = params.isBlocking !== false;

    try {
      this.broker.open(
        {
          requestId,
          sessionId: this.session.id,
          generation,
          turnId,
          itemId: params.itemId,
          questions: parsed.data,
          isBlocking,
          expiresAt: Date.now() + 30 * 60_000,
        },
        async (answers) => {
          if (
            this.requests.get(id) !== requestId ||
            generation !== this.session.generation ||
            turnId !== this.currentTurn() ||
            this.session.binding !== BindingState.Verified ||
            this.session.integrationState !== IntegrationState.Ready
          ) {
            throw new CodedError(ErrorCode.USER_INPUT_EXPIRED);
          }

          if (!this.session.capabilities.userInput) {
            throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
          }

          // Retain the native-id tombstone until the owner resolves it: never replay uncertain writes.
          await this.rpc.respond(id, { answers });

          if (
            isBlocking &&
            this.currentTurn() === turnId &&
            this.session.status === SessionStatus.WaitingInput
          ) {
            this.session.status = SessionStatus.Running;
          }

          this.changed();
        },
      );

      if (isBlocking) {
        this.session.status = SessionStatus.WaitingInput;
      }

      this.changed();
    } catch {
      this.requests.delete(id);
    }
  }
  resolved(id: unknown): void {
    if (typeof id !== 'string' && typeof id !== 'number') {
      return;
    }

    const requestId = this.requests.get(id);

    if (!requestId) {
      return;
    }

    this.requests.delete(id);
    this.broker?.cancel(requestId);
    this.changed();
  }
  clear(): void {
    for (const id of [...this.requests.keys()]) {
      this.resolved(id);
    }
  }
}
