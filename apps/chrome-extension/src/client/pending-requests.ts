import { ErrorCode, LOCAL_LIMITS } from '../../../../packages/protocol/src/index.js';

export function localError(code: string) {
  return Object.assign(new Error(code), code === ErrorCode.NOT_FOUND ? { status: 404 } : {});
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  cleanup(): void;
}

export class PendingRequests {
  private entries = new Map<string, Pending>();

  has(id: string) {
    return this.entries.has(id);
  }

  add(id: string, signal?: AbortSignal): Promise<unknown> {
    if (this.entries.size >= LOCAL_LIMITS.maxPendingRequests) {
      return Promise.reject(localError(ErrorCode.IPC_BUSY));
    }

    if (signal?.aborted) {
      return Promise.reject(localError(ErrorCode.ATTACHMENT_CANCELLED));
    }

    return new Promise((resolve, reject) => {
      const abort = () => this.reject(id, ErrorCode.ATTACHMENT_CANCELLED);

      const timer = setTimeout(
        () => this.reject(id, ErrorCode.REQUEST_TIMEOUT),
        LOCAL_LIMITS.requestTimeoutMs,
      );

      this.entries.set(id, {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
        },
      });

      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  private take(id: string) {
    const pending = this.entries.get(id);

    this.entries.delete(id);
    pending?.cleanup();

    return pending;
  }

  resolve(id: string, value: unknown) {
    this.take(id)?.resolve(value);
  }
  reject(id: string, code: string) {
    this.take(id)?.reject(localError(code));
  }
  clear(code: string) {
    for (const id of this.entries.keys()) {
      this.reject(id, code);
    }
  }
}
