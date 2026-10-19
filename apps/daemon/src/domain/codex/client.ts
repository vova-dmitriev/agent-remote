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
  respond(id: string | number, result: unknown): void | Promise<void>;
  reject?(id: string | number): void;
  pendingRequests?(): RpcFrame[];
  close(): Promise<void>;
}

export interface CodexBindingOptions {
  kind: typeof TargetKind.CodexCli | typeof TargetKind.CodexDesktop;
  threadId: string;
  endpoint: string;
}
