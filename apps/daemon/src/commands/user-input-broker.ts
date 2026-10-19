import { DaemonErrorCode } from '../error-codes.js';
import {
  ErrorCode,
  pendingUserInputSchema,
  positiveInteger,
  validateUserInputAnswers,
  type PendingUserInput,
  type UserInputAnswers,
} from '@protocol';

interface Entry {
  request: PendingUserInput;
  answer: (answers: UserInputAnswers) => void | Promise<void>;
  timer: ReturnType<typeof setTimeout>;
}
/** Ephemeral native questions. Expiry and cancellation never answer the owning application. */
export class UserInputBroker {
  private readonly entries = new Map<string, Entry>();
  private closed = false;
  private readonly maxWaitMs: number;
  private readonly maxPending: number;
  constructor(private options: { maxWaitMs?: number; maxPending?: number; changed?: () => void } = {}) {
    this.maxWaitMs = positiveInteger(options.maxWaitMs ?? 30 * 60_000, 'MAX_WAIT');
    this.maxPending = positiveInteger(options.maxPending ?? 100, 'MAX_PENDING');
  }
  open(source: PendingUserInput, answer: Entry['answer']): void {
    if (this.closed) {
      throw new Error(DaemonErrorCode.BROKER_CLOSED);
    }

    const request = pendingUserInputSchema.parse(structuredClone(source));

    if (this.entries.has(request.requestId)) {
      throw new Error(DaemonErrorCode.DUPLICATE_REQUEST);
    }

    if (this.entries.size >= this.maxPending) {
      throw new Error(ErrorCode.USER_INPUT_QUEUE_FULL);
    }

    request.expiresAt = Math.min(request.expiresAt, Date.now() + this.maxWaitMs);

    if (request.expiresAt <= Date.now()) {
      return;
    }

    const timer = setTimeout(() => this.cancel(request.requestId), request.expiresAt - Date.now());

    timer.unref();
    this.entries.set(request.requestId, { request, answer, timer });
    this.options.changed?.();
  }
  async submit(requestId: string, generation: string, raw: unknown): Promise<void> {
    const entry = this.entries.get(requestId);

    if (!entry || entry.request.generation !== generation) {
      throw new Error(ErrorCode.USER_INPUT_EXPIRED);
    }

    if (entry.request.expiresAt <= Date.now()) {
      this.cancel(requestId);
      throw new Error(ErrorCode.USER_INPUT_EXPIRED);
    }

    const answers = validateUserInputAnswers(entry.request, raw);

    this.cancel(requestId);

    try {
      await entry.answer(answers);
    } catch (error) {
      if (
        error instanceof Error &&
        [ErrorCode.USER_INPUT_EXPIRED, ErrorCode.STALE_SESSION, ErrorCode.CAPABILITY_UNAVAILABLE].some(
          (candidateValue) => candidateValue === error.message,
        )
      ) {
        throw error;
      }

      throw new Error(ErrorCode.UNKNOWN_AFTER_WRITE);
    }
  }
  pending(): PendingUserInput[] {
    for (const [id, entry] of this.entries) {
      if (entry.request.expiresAt <= Date.now()) {
        this.cancel(id);
      }
    }

    return [...this.entries.values()].map((entry) => structuredClone(entry.request));
  }
  cancel(requestId: string): void {
    const entry = this.entries.get(requestId);

    if (!entry) {
      return;
    }

    clearTimeout(entry.timer);
    this.entries.delete(requestId);
    this.options.changed?.();
  }
  cancelSession(sessionId: string, generation: string): void {
    for (const [id, entry] of this.entries) {
      if (entry.request.sessionId === sessionId && entry.request.generation === generation) {
        this.cancel(id);
      }
    }
  }
  clear(): void {
    for (const id of this.entries.keys()) {
      this.cancel(id);
    }
  }
  close(): void {
    this.closed = true;
    this.clear();
  }
}
