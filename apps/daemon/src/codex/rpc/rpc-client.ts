import { CodedError, ErrorCode } from '@protocol';
import { RuntimeEvent } from '../../domain/runtime.js';
import { CodexMethod } from '../../domain/codex/codex.js';
import type { RpcFrame } from '../../domain/codex/client.js';
import { EventEmitter } from 'node:events';
import { type Readable, type Writable } from 'node:stream';

export const MAX_CODEX_FRAME_BYTES = 32 * 1024 * 1024;
interface Options {
  input: Writable;
  output: Readable;
  timeoutMs?: number;
  maxFrameBytes?: number;
  close?: () => Promise<void>;
}
interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  mutating: boolean;
}
export class CodexRpcError extends Error {
  constructor(public rpcCode?: number) {
    super('CODEX_RPC_FAILED');
  }
}

const mutates = (method: string) =>
  ![
    CodexMethod.Initialize,
    CodexMethod.ThreadRead,
    CodexMethod.ThreadList,
    CodexMethod.ThreadLoadedList,
    CodexMethod.ThreadTurnsList,
    CodexMethod.ThreadItemsList,
    CodexMethod.AccountRead,
    CodexMethod.ModelList,
    CodexMethod.AccountRateLimitsRead,
    CodexMethod.ConfigRead,
  ].some((candidateValue) => candidateValue === method);

export class CodexRpcClient extends EventEmitter {
  private buffer = Buffer.alloc(0);
  private pending = new Map<string | number, Pending>();
  private sequence = 0;
  private closed = false;
  private initialization?: Promise<unknown>;
  private maximum: number;
  constructor(private options: Options) {
    super();
    this.maximum = options.maxFrameBytes ?? MAX_CODEX_FRAME_BYTES;
    options.output.on('data', this.receive);
    options.output.on('end', () => this.disconnect());
    options.output.on('error', () => this.disconnect());
    options.input.on('error', () => this.disconnect());
  }
  initialize() {
    return (this.initialization ??= this.request(CodexMethod.Initialize, {
      clientInfo: { name: 'claude_remote', title: 'Claude Remote', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    }).then((result) => {
      this.write({ method: CodexMethod.Initialized });

      return result;
    }));
  }
  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new CodedError(ErrorCode.CODEX_DISCONNECTED));
    }

    if (this.pending.size >= 64) {
      return Promise.reject(new CodedError(ErrorCode.CODEX_QUEUE_FULL));
    }

    return new Promise((resolve, reject) => {
      const id = ++this.sequence;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodedError(mutates(method) ? ErrorCode.UNKNOWN_AFTER_WRITE : ErrorCode.CODEX_TIMEOUT));
      }, this.options.timeoutMs ?? 15_000);

      this.pending.set(id, { resolve, reject, timer, mutating: mutates(method) });

      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  respond(id: string | number, result: unknown) {
    if (!result || typeof result !== 'object' || !Object.hasOwn(result, 'answers')) {
      this.write({ id, result });

      return;
    }

    return new Promise<void>((resolve, reject) => {
      const failed = () => finish(new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE));
      const timer = setTimeout(failed, this.options.timeoutMs ?? 15_000);

      timer.unref();

      const finish = (error?: Error | null) => {
        clearTimeout(timer);
        this.off(RuntimeEvent.Disconnected, failed);

        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      this.once(RuntimeEvent.Disconnected, failed);

      try {
        this.write({ id, result }, finish);
      } catch (error) {
        finish(error instanceof Error ? error : new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE));
      }
    });
  }
  reject(id: string | number) {
    this.write({ id, error: { code: -32601, message: 'Unsupported request' } });
  }
  disconnect(code = 'CODEX_DISCONNECTED') {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.options.output.off('data', this.receive);
    this.buffer = Buffer.alloc(0);

    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new CodedError(request.mutating ? ErrorCode.UNKNOWN_AFTER_WRITE : code));
    }

    this.pending.clear();
    this.emit(RuntimeEvent.Disconnected);
  }
  async close() {
    this.disconnect();
    await this.options.close?.();
  }
  private write(frame: unknown, complete?: (error?: Error | null) => void) {
    if (this.closed) {
      throw new CodedError(ErrorCode.CODEX_DISCONNECTED);
    }

    const line = JSON.stringify(frame) + '\n';

    if (
      Buffer.byteLength(line) > (this.options.maxFrameBytes ?? 4_194_304) ||
      this.options.input.writableLength > this.maximum
    ) {
      throw new CodedError(ErrorCode.CODEX_QUEUE_FULL);
    }

    this.options.input.write(line, complete);
  }
  private receive = (chunk: Buffer) => {
    if (this.closed) {
      return;
    }

    this.buffer = Buffer.concat([this.buffer, chunk]);
    let newline: number;

    while ((newline = this.buffer.indexOf(10)) !== -1) {
      if (newline > this.maximum) {
        this.disconnect('CODEX_PROTOCOL_ERROR');

        return;
      }

      const line = this.buffer.subarray(0, newline);

      this.buffer = this.buffer.subarray(newline + 1);

      if (!line.length) {
        continue;
      }

      try {
        const frame: RpcFrame = JSON.parse(line.toString('utf8'));

        if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
          throw new Error();
        }

        if (frame.method !== undefined) {
          if (typeof frame.method !== 'string') {
            throw new Error();
          }

          if (frame.id !== undefined && typeof frame.id !== 'string' && typeof frame.id !== 'number') {
            throw new Error();
          }

          this.emit(frame.id === undefined ? RuntimeEvent.Notification : RuntimeEvent.Request, frame);
        } else if (typeof frame.id === 'string' || typeof frame.id === 'number') {
          const pending = this.pending.get(frame.id);

          if (!pending) {
            continue;
          }

          this.pending.delete(frame.id);
          clearTimeout(pending.timer);

          if (frame.error) {
            pending.reject(new CodexRpcError(frame.error.code));
          } else {
            pending.resolve(frame.result);
          }
        } else {
          throw new Error();
        }
      } catch {
        this.disconnect('CODEX_PROTOCOL_ERROR');

        return;
      }
    }

    if (this.buffer.length > this.maximum) {
      this.disconnect('CODEX_PROTOCOL_ERROR');
    }
  };
}
