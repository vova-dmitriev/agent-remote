import {
  ConnectionStatus,
  ErrorCode,
  FrameType,
  type LocalAction,
  type ServerFrame,
} from '../../../../packages/protocol/src/index.js';
import { chromeApi, type ChromeApi } from '../config/chrome-api.js';
import { localError } from './pending-requests.js';
import { ReconnectBackoff } from './lifecycle/backoff.js';
import { PortSession } from './lifecycle/port-session.js';
import { TERMINAL_AUTH_ERRORS, TERMINAL_CONNECTION_ERRORS } from './lifecycle/values.js';

export class ExtensionConnection {
  private session: PortSession | null = null;
  private frames = new Set<(frame: ServerFrame) => void>();
  private states = new Set<(state: ConnectionStatus) => void>();
  private backoff = new ReconnectBackoff();
  private starting: Promise<void> | null = null;
  private resolveStart: (() => void) | undefined;
  private rejectStart: ((error: Error) => void) | undefined;
  private closed = false;
  private currentState: ConnectionStatus | null = null;

  constructor(private chrome: ChromeApi = chromeApi()) {}

  get grant() {
    return this.session?.grant ?? null;
  }

  start(): Promise<void> {
    if (this.closed) {
      return Promise.reject(localError(ErrorCode.IPC_CLOSED));
    }

    if (this.starting) {
      return this.starting;
    }

    this.starting = new Promise((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });

    void this.connect();

    return this.starting;
  }

  private async connect() {
    if (this.closed) {
      return;
    }

    this.state(ConnectionStatus.Connecting);

    const session = new PortSession(
      this.chrome,
      (frame) => {
        if (this.session === session && !this.closed) {
          this.publish(frame);
        }
      },
      (code, reported) => {
        if (this.session === session && !this.closed) {
          this.disconnected(code, reported);
        }
      },
    );

    this.session = session;

    try {
      await session.start();

      if (this.closed || this.session !== session) {
        return;
      }

      this.state(ConnectionStatus.Online);
      this.resolveStart?.();
      this.resolveStart = this.rejectStart = undefined;
    } catch {
      // PortSession reports and fences each failed attempt exactly once.
    }
  }

  private disconnected(code: string, reported: boolean) {
    this.session = null;

    if (!reported) {
      this.publish({ type: FrameType.Error, code });
    }

    const terminal = TERMINAL_CONNECTION_ERRORS.has(code);

    if (terminal) {
      this.backoff.close();
      this.rejectStart?.(localError(code));
      this.resolveStart = this.rejectStart = undefined;
      this.closed = true;
    }

    this.state(TERMINAL_AUTH_ERRORS.has(code) ? ConnectionStatus.Expired : ConnectionStatus.Offline);

    if (this.closed) {
      return;
    }

    if (
      !this.backoff.schedule(() => {
        void this.connect();
      })
    ) {
      this.backoff.close();
      this.rejectStart?.(localError(code));
      this.resolveStart = this.rejectStart = undefined;
    }
  }

  request(action: LocalAction, signal?: AbortSignal): Promise<unknown> {
    return this.session?.request(action, signal) ?? Promise.reject(localError(ErrorCode.IPC_CLOSED));
  }

  subscribe(listener: (frame: ServerFrame) => void) {
    this.frames.add(listener);

    return () => {
      this.frames.delete(listener);
    };
  }

  subscribeConnection(listener: (state: ConnectionStatus) => void) {
    this.states.add(listener);

    if (this.currentState) {
      listener(this.currentState);
    }

    return () => {
      this.states.delete(listener);
    };
  }

  private publish(frame: ServerFrame) {
    for (const listener of this.frames) {
      listener(frame);
    }
  }
  private state(state: ConnectionStatus) {
    this.currentState = state;

    for (const listener of this.states) {
      listener(state);
    }
  }

  close() {
    this.closed = true;
    this.backoff.close();
    this.session?.close();
    this.session = null;
    this.rejectStart?.(localError(ErrorCode.IPC_CLOSED));
    this.resolveStart = this.rejectStart = undefined;
  }
}
