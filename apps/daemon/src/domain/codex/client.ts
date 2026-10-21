import type { EventEmitter } from 'node:events';
import type { TargetKind } from '@protocol';

export interface RpcFrame {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number };
}

export interface CodexClient extends EventEmitter {
  request(method: string, params: unknown): Promise<unknown>;
  /** Desktop native clients may provide a bounded, owner-verified child-thread read. */
  readSubagentItems?(threadId: string, params: unknown): Promise<unknown>;
  respond(id: string | number, result: unknown): void | Promise<void>;
  reject?(id: string | number): void;
  pendingRequests?(): RpcFrame[];
  close(): Promise<void>;
}

export interface CodexBindingOptions {
  kind: typeof TargetKind.CodexCli | typeof TargetKind.CodexDesktop;
  threadId: string;
  endpoint: string;
  /**
   * This connection just started the thread, so it already follows it. Codex writes a thread's rollout with its
   * first turn, and resuming an empty thread fails ("no rollout found"), so a started thread is not resumed.
   */
  started?: boolean;
}
