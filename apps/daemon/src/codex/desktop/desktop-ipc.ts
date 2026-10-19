import { DaemonErrorCode } from '../../error-codes.js';
import { CodedError, ErrorCode } from '@protocol';

import {
  CodexDesktopMethod,
  CodexDesktopHost,
  CodexDesktopMessageType,
  CodexDesktopResultType,
} from '../../domain/codex/codex-desktop.js';
import { RuntimeEvent } from '../../domain/runtime.js';
import { EventEmitter } from 'node:events';
import { connect, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { verifyLocalSocket } from '../rpc/transport.js';
import { object, type Data } from '../events.js';

const versions: Record<string, number> = {
  [CodexDesktopMethod.ThreadOwnerDiscovery]: 1,
  [CodexDesktopMethod.ThreadFollowerStartTurn]: 2,
  [CodexDesktopMethod.ThreadFollowerInterruptTurn]: 4,
};

interface Pending {
  resolve: (frame: Data) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
export class DesktopIpcClient extends EventEmitter {
  private buffer = Buffer.alloc(0);
  private pending = new Map<string, Pending>();
  private clientId = 'initializing-client';
  private closed = false;
  private constructor(
    private socket: Socket,
    private timeoutMs = 5000,
  ) {
    super();
    socket.on('data', this.receive);
    socket.on('error', () => this.disconnect());
    socket.on('close', () => this.disconnect());
  }
  static async connect(path: string, timeoutMs = 5000) {
    await verifyLocalSocket(path);
    const socket = connect(path);
    const client = new DesktopIpcClient(socket, timeoutMs);
    const timer = setTimeout(() => socket.destroy(new CodedError(ErrorCode.CODEX_TIMEOUT)), timeoutMs);

    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });

      const response = await client.call(
        CodexDesktopMethod.Initialize,
        { clientType: 'claude-remote' },
        undefined,
        0,
      );

      const id = object(response.result).clientId;

      if (typeof id !== 'string') {
        throw new CodedError(ErrorCode.CODEX_PROTOCOL_ERROR);
      }

      client.clientId = id;

      return client;
    } catch (error) {
      await client.close();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async owner(conversationId: string): Promise<string | null> {
    try {
      const response = await this.call(CodexDesktopMethod.ThreadOwnerDiscovery, {
        hostId: CodexDesktopHost.Local,
        conversationId,
      });

      return typeof response.handledByClientId === 'string' ? response.handledByClientId : null;
    } catch {
      return null;
    }
  }
  async request(method: string, params: unknown, targetClientId: string) {
    const response = await this.call(method, params, targetClientId);

    return response.result;
  }
  broadcast(method: string, params: unknown, targetClientId: string) {
    this.send({
      type: CodexDesktopMessageType.Broadcast,
      method,
      params,
      version: method === CodexDesktopMethod.ThreadStreamFollowingChanged ? 1 : 0,
      sourceClientId: this.clientId,
      targetClientIds: [targetClientId],
    });
  }
  async close() {
    this.disconnect();
  }
  private call(
    method: string,
    params: unknown,
    targetClientId?: string,
    version = versions[method] ?? 1,
  ): Promise<Data> {
    if (this.closed) {
      return Promise.reject(new CodedError(ErrorCode.CODEX_DISCONNECTED));
    }

    if (this.pending.size >= 64) {
      return Promise.reject(new CodedError(ErrorCode.CODEX_QUEUE_FULL));
    }

    return new Promise((resolve, reject) => {
      const requestId = randomUUID();

      const mutating =
        method.startsWith('thread-follower-') &&
        ![
          CodexDesktopMethod.ThreadFollowerReadModelSettings,
          CodexDesktopMethod.ThreadFollowerLoadCompleteHistory,
        ].some((candidateValue) => candidateValue === method);

      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new CodedError(mutating ? ErrorCode.UNKNOWN_AFTER_WRITE : ErrorCode.CODEX_TIMEOUT));
      }, this.timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });

      try {
        this.send({
          type: CodexDesktopMessageType.Request,
          requestId,
          sourceClientId: this.clientId,
          version,
          method,
          params,
          ...(targetClientId ? { targetClientId } : {}),
        });
      } catch (error) {
        this.pending.delete(requestId);
        clearTimeout(timer);
        reject(error);
      }
    });
  }
  private send(frame: unknown) {
    if (this.closed) {
      throw new CodedError(ErrorCode.CODEX_DISCONNECTED);
    }

    const data = Buffer.from(JSON.stringify(frame));

    if (data.length > 1_048_576 || this.socket.writableLength > 1_048_576) {
      throw new CodedError(ErrorCode.CODEX_QUEUE_FULL);
    }

    const header = Buffer.alloc(4);

    header.writeUInt32LE(data.length);
    this.socket.write(Buffer.concat([header, data]));
  }
  private receive = (chunk: Buffer) => {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);

      if (length > 32 * 1024 * 1024 || length === 0) {
        this.disconnect();

        return;
      }

      if (this.buffer.length < length + 4) {
        return;
      }

      const data = this.buffer.subarray(4, length + 4);

      this.buffer = this.buffer.subarray(length + 4);

      try {
        const frame = object(JSON.parse(data.toString('utf8')));

        if (frame.type === CodexDesktopMessageType.Response && typeof frame.requestId === 'string') {
          const pending = this.pending.get(frame.requestId);

          if (!pending) {
            continue;
          }

          this.pending.delete(frame.requestId);
          clearTimeout(pending.timer);

          if (frame.resultType === CodexDesktopResultType.Success) {
            pending.resolve(frame);
          } else {
            pending.reject(new CodedError(DaemonErrorCode.CODEX_DESKTOP_REQUEST_FAILED));
          }
        } else if (frame.type === CodexDesktopMessageType.ClientDiscoveryRequest) {
          this.send({
            type: CodexDesktopMessageType.ClientDiscoveryResponse,
            requestId: frame.requestId,
            response: { canHandle: false },
          });
        } else if (frame.type === CodexDesktopMessageType.Broadcast) {
          this.emit(RuntimeEvent.Broadcast, frame);
        }
      } catch {
        this.disconnect();

        return;
      }
    }
  };
  private disconnect() {
    if (this.closed) {
      return;
    }

    this.closed = true;

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE));
    }

    this.pending.clear();
    this.socket.destroy();
    this.buffer = Buffer.alloc(0);
    this.emit(RuntimeEvent.Disconnected);
  }
}
