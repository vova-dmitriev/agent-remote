import { CodexMethod, CodexApprovalDecision } from '../../domain/codex/codex.js';
import { SessionStatus, PermissionDecision, type Session } from '@protocol';
import { CodexDesktopHost } from '../../domain/codex/codex-desktop.js';
import { randomUUID } from 'node:crypto';
import { type PermissionBroker } from '../../commands/permission-broker.js';
import { type CodexClient } from './binding.js';
import { type RpcFrame } from '../rpc/rpc-client.js';
import { object } from '../events.js';

export class CodexApprovals {
  private requests = new Map<string | number, string>();
  constructor(
    private rpc: CodexClient,
    private session: Session,
    private broker: PermissionBroker,
    private currentTurn: () => string | null,
    private changed: () => void,
    private enabled: boolean,
  ) {}
  request(frame: RpcFrame) {
    const params = object(frame.params),
      id = frame.id;

    if (
      id === undefined ||
      params.threadId !== ('threadId' in this.session.target ? this.session.target.threadId : null)
    ) {
      return;
    }

    if (
      ![CodexMethod.ItemCommandExecutionRequestApproval, CodexMethod.ItemFileChangeRequestApproval].some(
        (candidateValue) => candidateValue === (frame.method ?? ''),
      )
    ) {
      this.rpc.reject?.(id);

      return;
    }

    if (!this.enabled || params.turnId !== this.currentTurn() || typeof params.itemId !== 'string') {
      return;
    }

    if (this.requests.has(id)) {
      return;
    }

    const requestId = randomUUID(),
      turn = this.currentTurn();

    this.requests.set(id, requestId);
    this.session.status = SessionStatus.WaitingPermission;

    const answer = this.broker.open({
      requestId,
      sessionId: this.session.id,
      generation: this.session.generation,
      toolName:
        frame.method === CodexMethod.ItemFileChangeRequestApproval ? 'Codex file change' : 'Codex command',
      input: {
        ...(typeof params.command === 'string' ? { command: params.command.slice(0, 8192) } : {}),
        ...(typeof params.reason === 'string' ? { reason: params.reason.slice(0, 2048) } : {}),
      },
      expiresAt: Date.now() + 45_000,
    });

    this.changed();

    void answer
      .then((decision) => {
        if (this.requests.get(id) !== requestId) {
          return;
        }

        if (turn !== this.currentTurn() || decision === CodexDesktopHost.Local) {
          this.changed();

          return;
        }

        this.requests.delete(id);

        try {
          this.rpc.respond(id, {
            decision:
              decision === PermissionDecision.Allow
                ? CodexApprovalDecision.Accept
                : CodexApprovalDecision.Decline,
          });
        } catch {}

        this.session.status = this.requests.size ? SessionStatus.WaitingPermission : SessionStatus.Running;
        this.changed();
      })
      .catch(() => {
        this.requests.delete(id);
        this.changed();
      });
  }
  resolved(id: unknown) {
    if (typeof id !== 'string' && typeof id !== 'number') {
      return;
    }

    const requestId = this.requests.get(id);

    if (!requestId) {
      return;
    }

    this.requests.delete(id);
    this.broker.cancel(requestId);

    if (!this.requests.size && this.currentTurn()) {
      this.session.status = SessionStatus.Running;
    }

    this.changed();
  }
  clear() {
    for (const id of [...this.requests.keys()]) {
      this.resolved(id);
    }
  }
}
