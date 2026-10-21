import { DaemonErrorCode } from '../error-codes.js';
import {
  CodedError,
  ErrorCode,
  hasErrorCode,
  type PendingUserInput,
  pendingUserInputSchema,
  positiveInteger,
  type UserInputAnswers,
  validateUserInputAnswers,
} from '@protocol';

interface Entry {
  request: PendingUserInput;
  answer: (answers: UserInputAnswers) => void | Promise<void>;
  cancelled?: () => void;
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
  open(source: PendingUserInput, answer: Entry['answer'], cancelled?: Entry['cancelled']): void {
    if (this.closed) {
      throw new CodedError(DaemonErrorCode.BROKER_CLOSED);
    }

    const request = pendingUserInputSchema.parse(structuredClone(source));

    if (this.entries.has(request.requestId)) {
      throw new CodedError(DaemonErrorCode.DUPLICATE_REQUEST);
    }

    if (this.entries.size >= this.maxPending) {
      throw new CodedError(ErrorCode.USER_INPUT_QUEUE_FULL);
    }

    request.expiresAt = Math.min(request.expiresAt, Date.now() + this.maxWaitMs);

    if (request.expiresAt <= Date.now()) {
      return;
    }

    const timer = setTimeout(() => this.cancel(request.requestId), request.expiresAt - Date.now());

    timer.unref();
    this.entries.set(request.requestId, { request, answer, ...(cancelled ? { cancelled } : {}), timer });
    this.options.changed?.();
  }
  async submit(requestId: string, generation: string, raw: unknown): Promise<void> {
    const entry = this.entries.get(requestId);

    if (!entry || entry.request.generation !== generation) {
      throw new CodedError(ErrorCode.USER_INPUT_EXPIRED);
    }

    if (entry.request.expiresAt <= Date.now()) {
      this.cancel(requestId);
      throw new CodedError(ErrorCode.USER_INPUT_EXPIRED);
    }

    const answers = validateUserInputAnswers(entry.request, raw);

    this.take(requestId);
    this.options.changed?.();

    try {
      await entry.answer(answers);
    } catch (error) {
      if (
        error instanceof Error &&
        [ErrorCode.USER_INPUT_EXPIRED, ErrorCode.STALE_SESSION, ErrorCode.CAPABILITY_UNAVAILABLE].some(
          (candidateValue) => hasErrorCode(error, candidateValue),
        )
      ) {
        throw error;
      }

      throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
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
    const entry = this.take(requestId);

    if (!entry) {
      return;
    }

    entry.cancelled?.();
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
  private take(requestId: string): Entry | undefined {
    const entry = this.entries.get(requestId);

    if (entry) {
      clearTimeout(entry.timer);
      this.entries.delete(requestId);
    }

    return entry;
  }
}
