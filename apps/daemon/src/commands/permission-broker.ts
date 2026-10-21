import { DaemonErrorCode } from '../error-codes.js';
import {
  CodedError,
  ErrorCode,
  PermissionDecision,
  positiveInteger,
  RULE_ANSWER_TIMEOUT_MS,
  type PermissionRule,
  type RemotePermissionDecision,
} from '@protocol';

import { ClaudeHookEvent } from '../domain/claude.js';

export { PermissionDecision } from '@protocol';
export interface PendingPermission {
  requestId: string;
  sessionId: string;
  generation: string;
  toolName: string;
  input: unknown;
  expiresAt: number;
  /** The owner's rule that stopped the command; such a request may be answered allow-always. */
  rule?: PermissionRule;
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

  /** A rule stop waits for the owner longer than the agent's own prompts do. */
  async open(source: PendingPermission): Promise<PermissionDecision> {
    if (this.closed) {
      throw new CodedError(DaemonErrorCode.BROKER_CLOSED);
    }

    if (
      !source ||
      ['requestId', 'sessionId', 'generation', 'toolName'].some((key) => {
        const value = source[key as keyof PendingPermission];

        return typeof value !== 'string' || value.length === 0 || value.length > 512;
      }) ||
      !Number.isFinite(source.expiresAt)
    ) {
      throw new CodedError(ErrorCode.INVALID_PERMISSION_REQUEST);
    }

    if (this.entries.has(source.requestId)) {
      throw new CodedError(DaemonErrorCode.DUPLICATE_REQUEST);
    }

    if (this.entries.size >= this.maxPending) {
      throw new CodedError(ErrorCode.PERMISSION_QUEUE_FULL);
    }

    const now = Date.now();

    const request = structuredClone({
      ...source,
      expiresAt: Math.min(source.expiresAt, now + (source.rule ? RULE_ANSWER_TIMEOUT_MS : this.maxWaitMs)),
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
      ![PermissionDecision.Allow, PermissionDecision.AllowAlways, PermissionDecision.Deny].some(
        (value) => value === decision,
      )
    ) {
      return false;
    }

    // Allow-always means something only for a rule stop; for the agent's own prompt it is an allow.
    this.finish(
      requestId,
      decision === PermissionDecision.AllowAlways && !entry.request.rule
        ? PermissionDecision.Allow
        : decision,
    );

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

export function permissionHookOutput(answer: PermissionDecision) {
  const decision = answer === PermissionDecision.AllowAlways ? PermissionDecision.Allow : answer;

  if (decision === PermissionDecision.Local) {
    return {};
  }

  if (decision !== PermissionDecision.Allow && decision !== PermissionDecision.Deny) {
    throw new CodedError(ErrorCode.INVALID_PERMISSION_DECISION);
  }

  return {
    hookSpecificOutput: {
      hookEventName: ClaudeHookEvent.PermissionRequest,
      decision: { behavior: decision },
    },
  };
}
