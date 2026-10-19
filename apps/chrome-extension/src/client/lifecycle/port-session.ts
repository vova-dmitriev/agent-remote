import {
  ErrorCode,
  FrameType,
  LocalKind,
  LOCAL_LIMITS,
  localActionSchema,
  localEventSchema,
  localGrantSchema,
  localResultSchema,
  type LocalAction,
  type LocalClientGrant,
  type ServerFrame,
} from '@protocol';
import type { ChromeApi, ChromePort } from '../../config/chrome-api.js';
import { ExtensionConfig } from '../../config/values.js';
import { PendingRequests, localError } from '../pending-requests.js';
import { TERMINAL_CONNECTION_ERRORS } from './values.js';

export class PortSession {
  private port: ChromePort | null = null;
  private pending = new PendingRequests();
  private ended = false;
  grant: LocalClientGrant | null = null;

  constructor(
    private chrome: ChromeApi,
    private publish: (frame: ServerFrame) => void,
    private lost: (code: string, reported: boolean) => void,
  ) {}

  async start() {
    try {
      const port = this.chrome.runtime.connect({ name: ExtensionConfig.ViewerPortName });

      this.port = port;
      port.onMessage.addListener(this.receive);
      port.onDisconnect.addListener(this.disconnected);
      const requestId = crypto.randomUUID();
      const response = this.pending.add(requestId);

      try {
        port.postMessage({
          kind: LocalKind.Hello,
          version: LOCAL_LIMITS.protocolVersion,
          requestId,
          clientId: crypto.randomUUID(),
        });
      } catch {
        this.pending.reject(requestId, ErrorCode.LOCAL_HOST_UNAVAILABLE);
      }

      const grant = localGrantSchema.parse(await response);

      if (this.ended) {
        throw localError(ErrorCode.IPC_CLOSED);
      }

      this.grant = grant;
    } catch (error) {
      const known = error instanceof Error && Object.values(ErrorCode).some((code) => code === error.message);
      const code = known ? (error as Error).message : ErrorCode.LOCAL_HOST_UNAVAILABLE;

      this.end(code, true, false);
      throw localError(code);
    }
  }

  request(action: LocalAction, signal?: AbortSignal): Promise<unknown> {
    if (!this.port || !this.grant || this.ended) {
      return Promise.reject(localError(ErrorCode.IPC_CLOSED));
    }

    const parsed = localActionSchema.parse(action);
    const requestId = crypto.randomUUID();
    const response = this.pending.add(requestId, signal);

    if (!signal?.aborted && this.pending.has(requestId)) {
      try {
        this.port.postMessage({
          kind: LocalKind.Request,
          version: LOCAL_LIMITS.protocolVersion,
          requestId,
          lease: this.grant.lease,
          action: parsed,
        });
      } catch {
        this.end(ErrorCode.NETWORK_UNAVAILABLE, true, false);
      }
    }

    return response;
  }

  private receive = (message: unknown) => {
    if (this.ended) {
      return;
    }

    const result = localResultSchema.safeParse(message);

    if (result.success) {
      if (result.data.ok) {
        this.pending.resolve(result.data.requestId, result.data.data);
      } else {
        this.pending.reject(result.data.requestId, result.data.code);

        if (!this.grant || TERMINAL_CONNECTION_ERRORS.has(result.data.code)) {
          this.publish({ type: FrameType.Error, code: result.data.code });
          this.end(result.data.code, true, true);
        }
      }

      return;
    }

    const event = localEventSchema.safeParse(message);

    if (!event.success || !this.grant || event.data.lease !== this.grant.lease) {
      return;
    }

    const frame = event.data.frame;

    this.publish(frame);

    if (
      frame.type === FrameType.Error &&
      (TERMINAL_CONNECTION_ERRORS.has(frame.code) || frame.code === ErrorCode.LOCAL_HOST_UNAVAILABLE)
    ) {
      this.end(frame.code, true, true);
    }
  };

  private disconnected = () => {
    const code = this.chrome.runtime.lastError
      ? ErrorCode.LOCAL_HOST_UNAVAILABLE
      : ErrorCode.NETWORK_UNAVAILABLE;

    this.end(code, true, false);
  };

  private end(code: string, notify: boolean, reported: boolean) {
    if (this.ended) {
      return;
    }

    this.ended = true;
    this.grant = null;
    this.pending.clear(code);
    const port = this.port;

    this.port = null;
    port?.onMessage.removeListener(this.receive);
    port?.onDisconnect.removeListener(this.disconnected);

    if (notify) {
      this.lost(code, reported);
    }

    port?.disconnect();
  }

  close() {
    this.end(ErrorCode.IPC_CLOSED, false, false);
  }
}
