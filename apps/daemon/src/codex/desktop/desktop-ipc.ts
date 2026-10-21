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
import { OversizeFrame, type OversizeFrameRoute } from './oversize-frame.js';

/** Largest IPC frame buffered in memory; larger frames are drained and fail only their own route. */
const MAX_FRAME_BYTES = 32 * 1024 * 1024;
/** Oversize (conversation, sending client) marks remembered on this connection. */
const MAX_OVERSIZED_CONVERSATIONS = 64;
/** How long an oversize thread is left alone before one attach retries it (it may have shrunk). */
const OVERSIZE_RETRY_MS = 10 * 60 * 1000;

/** Emitted with `RuntimeEvent.FrameTooLarge` when an owner's broadcast for one conversation exceeded the cap. */
export interface OversizedConversation {
  conversationId: string;
  sourceClientId: string;
}

/** Marks are per sending client, so another client's frame never replaces the owner's mark. */
function oversizeMarkKey(conversationId: string, sourceClientId: string) {
  return JSON.stringify([conversationId, sourceClientId]);
}

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
  private buffer: Buffer = Buffer.alloc(0);
  private draining: OversizeFrame | null = null;
  /** Retry time per oversize (conversation, sending client). */
  private oversized = new Map<string, number>();
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
    const socket = connect(await verifyLocalSocket(path));
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
  /** True while the owner's last broadcast for this conversation exceeded the frame cap, until its retry time. */
  frameTooLarge(conversationId: string, ownerClientId: string) {
    const key = oversizeMarkKey(conversationId, ownerClientId);
    const retryAt = this.oversized.get(key);

    if (retryAt === undefined) {
      return false;
    }

    if (Date.now() >= retryAt) {
      this.oversized.delete(key);

      return false;
    }

    return true;
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
    let input = chunk;

    if (this.draining) {
      input = input.subarray(this.draining.consume(input));

      if (this.draining.invalid) {
        this.disconnect();

        return;
      }

      if (!this.draining.done) {
        return;
      }

      const route = this.draining.route();

      this.draining = null;
      this.dropOversize(route);
    }

    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, input]) : input;

    while (!this.closed && this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);

      if (length === 0) {
        this.disconnect();

        return;
      }

      if (length > MAX_FRAME_BYTES) {
        const frame = new OversizeFrame(length);
        const rest = this.buffer.subarray(4);

        this.buffer = rest.subarray(frame.consume(rest));

        // A garbled length must not stall the shared socket: drop it so the manager reconnects.
        if (frame.invalid) {
          this.disconnect();

          return;
        }

        if (!frame.done) {
          this.draining = frame;

          return;
        }

        this.dropOversize(frame.route());
        continue;
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
  /** Fails only the request or followed conversation that produced a drained oversize frame. */
  private dropOversize(route: OversizeFrameRoute) {
    if (route.type === CodexDesktopMessageType.Response && route.requestId) {
      const pending = this.pending.get(route.requestId);

      if (pending) {
        this.pending.delete(route.requestId);
        clearTimeout(pending.timer);
        pending.reject(new CodedError(ErrorCode.CODEX_FRAME_TOO_LARGE));
      }

      return;
    }

    // Only an owner's broadcast can be attributed to a followed thread; others are dropped.
    if (route.type !== CodexDesktopMessageType.Broadcast || !route.conversationId || !route.sourceClientId) {
      return;
    }

    const key = oversizeMarkKey(route.conversationId, route.sourceClientId);

    this.oversized.delete(key);

    if (this.oversized.size >= MAX_OVERSIZED_CONVERSATIONS) {
      this.oversized.delete(this.oversized.keys().next().value!);
    }

    this.oversized.set(key, Date.now() + OVERSIZE_RETRY_MS);

    const conversation: OversizedConversation = {
      conversationId: route.conversationId,
      sourceClientId: route.sourceClientId,
    };

    this.emit(RuntimeEvent.FrameTooLarge, conversation);
  }
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
    this.draining = null;
    this.emit(RuntimeEvent.Disconnected);
  }
}
