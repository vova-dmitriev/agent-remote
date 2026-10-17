import {
  PermissionDecision,
  type RemotePermissionDecision,
  positiveInteger,
} from '../../../../packages/protocol/src/index.js';
import { ClaudeHookEvent } from '../domain/claude.js';

export { PermissionDecision } from '../../../../packages/protocol/src/index.js';
export interface PendingPermission {
  requestId: string;
  sessionId: string;
  generation: string;
  toolName: string;
  input: unknown;
  expiresAt: number;
}
interface Entry {
  request: PendingPermission;
  finish: (answer: PermissionDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Local transport-neutral broker. Callers must authenticate/authorize before resolve(). */
export class PermissionBroker {
  private readonly entries = new Map<string, Entry>();
  private readonly maxWaitMs: number;
  private readonly maxPending: number;
  private closed = false;

  constructor(options: { maxWaitMs?: number; maxPending?: number } = {}) {
    this.maxWaitMs = Math.min(45_000, positiveInteger(options.maxWaitMs ?? 45_000, 'MAX_WAIT'));
    this.maxPending = positiveInteger(options.maxPending ?? 100, 'MAX_PENDING');
  }

  async open(source: PendingPermission): Promise<PermissionDecision> {
    if (this.closed) {
      throw new Error('BROKER_CLOSED');
    }

    if (
      !source ||
      ['requestId', 'sessionId', 'generation', 'toolName'].some((key) => {
        const value = source[key as keyof PendingPermission];

        return typeof value !== 'string' || value.length === 0 || value.length > 512;
      }) ||
      !Number.isFinite(source.expiresAt)
    ) {
      throw new Error('INVALID_PERMISSION_REQUEST');
    }

    if (this.entries.has(source.requestId)) {
      throw new Error('DUPLICATE_REQUEST');
    }

    if (this.entries.size >= this.maxPending) {
      throw new Error('PERMISSION_QUEUE_FULL');
    }

    const now = Date.now();

    const request = structuredClone({
      ...source,
      expiresAt: Math.min(source.expiresAt, now + this.maxWaitMs),
    });

    if (request.expiresAt <= now) {
      return PermissionDecision.Local;
    }

    return new Promise((resolve) => {
      const timer = setTimeout(
        () => this.finish(request.requestId, PermissionDecision.Local),
        request.expiresAt - now,
      );

      timer.unref();
      this.entries.set(request.requestId, { request, finish: resolve, timer });
    });
  }

  resolve(requestId: string, generation: string, decision: RemotePermissionDecision): boolean {
    const entry = this.entries.get(requestId);

    if (!entry) {
      return false;
    }

    if (entry.request.expiresAt <= Date.now()) {
      this.finish(requestId, PermissionDecision.Local);

      return false;
    }

    if (
      entry.request.generation !== generation ||
      (decision !== PermissionDecision.Allow && decision !== PermissionDecision.Deny)
    ) {
      return false;
    }

    this.finish(requestId, decision);

    return true;
  }

  pending(): PendingPermission[] {
    for (const [id, entry] of this.entries) {
      if (entry.request.expiresAt <= Date.now()) {
        this.finish(id, PermissionDecision.Local);
      }
    }

    return [...this.entries.values()].map((entry) => structuredClone(entry.request));
  }

  cancel(requestId: string): void {
    this.finish(requestId, PermissionDecision.Local);
  }

  cancelSession(sessionId: string, generation: string): void {
    for (const [id, entry] of this.entries) {
      if (entry.request.sessionId === sessionId && entry.request.generation === generation) {
        this.finish(id, PermissionDecision.Local);
      }
    }
  }

  close(): void {
    this.closed = true;

    for (const id of this.entries.keys()) {
      this.finish(id, PermissionDecision.Local);
    }
  }

  private finish(id: string, answer: PermissionDecision): void {
    const entry = this.entries.get(id);

    if (!entry) {
      return;
    }

    this.entries.delete(id);
    clearTimeout(entry.timer);
    entry.finish(answer);
  }
}

export function permissionHookOutput(decision: PermissionDecision) {
  if (decision === PermissionDecision.Local) {
    return {};
  }

  if (decision !== PermissionDecision.Allow && decision !== PermissionDecision.Deny) {
    throw new Error('INVALID_PERMISSION_DECISION');
  }

  return {
    hookSpecificOutput: {
      hookEventName: ClaudeHookEvent.PermissionRequest,
      decision: { behavior: decision },
    },
  };
}
