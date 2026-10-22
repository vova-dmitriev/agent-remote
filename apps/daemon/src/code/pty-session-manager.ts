import { DaemonErrorCode } from '../error-codes.js';
import { CodedError, ErrorCode, positiveInteger, TerminalKey, validatePrompt } from '@protocol';

import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { spawn as spawnPty } from 'node-pty';

/** What each key the Terminal tab presses sends down an xterm PTY. */
const TERMINAL_KEY_BYTES: Record<TerminalKey, string> = {
  [TerminalKey.Enter]: '\r',
  [TerminalKey.Escape]: '\x1b',
  [TerminalKey.Tab]: '\t',
  [TerminalKey.Up]: '\x1b[A',
  [TerminalKey.Down]: '\x1b[B',
  [TerminalKey.Interrupt]: '\x03',
};

export interface Disposable {
  dispose(): void;
}
export interface PtyProcess {
  write(text: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (text: string) => void): Disposable;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): Disposable;
}
export interface PtyBinding {
  id: string;
  generation: string;
}
export interface RemotePtyBinding extends PtyBinding {
  claudeSessionId: string;
  lease: string;
}
interface Session {
  binding: PtyBinding;
  process: PtyProcess;
  remote?: RemotePtyBinding;
  subscriptions: Set<Disposable>;
  stopping: boolean;
  exitListeners: Set<(event: { exitCode: number; signal?: number }) => void>;
}
interface SpawnOptions {
  cwd: string;
  cols: number;
  rows: number;
  name: string;
  env: NodeJS.ProcessEnv;
}
interface ManagerOptions {
  /** Fixed by the local launcher, never accepted from a remote command. */
  executable?: string;
  args?: readonly string[];
  maxSessions?: number;
  spawn?: (executable: string, args: string[], options: SpawnOptions) => PtyProcess;
}

/** Owns only processes explicitly started here; never attaches to an arbitrary terminal. */
export class PtySessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly executable: string;
  private readonly args: string[];
  private readonly maxSessions: number;
  private readonly spawn: NonNullable<ManagerOptions['spawn']>;
  private closed = false;

  constructor(options: ManagerOptions = {}) {
    this.executable = options.executable ?? 'claude';
    this.args = [...(options.args ?? [])];
    this.maxSessions = positiveInteger(options.maxSessions ?? 10, 'MAX_PTY_SESSIONS');
    this.spawn = options.spawn ?? ((file, args, settings) => spawnPty(file, args, settings));
  }

  start(options: { id: string; cwd: string; cols?: number; rows?: number }): PtyBinding {
    if (this.closed) {
      throw new CodedError(DaemonErrorCode.PTY_MANAGER_CLOSED);
    }

    if (
      typeof options.id !== 'string' ||
      !options.id ||
      options.id.length > 512 ||
      !isAbsolute(options.cwd)
    ) {
      throw new CodedError(DaemonErrorCode.INVALID_PTY_START);
    }

    if (this.sessions.has(options.id)) {
      throw new CodedError(DaemonErrorCode.PTY_ALREADY_EXISTS);
    }

    if (this.sessions.size >= this.maxSessions) {
      throw new CodedError(ErrorCode.PTY_LIMIT_REACHED);
    }

    const cols = options.cols ?? 80;
    const rows = options.rows ?? 24;

    this.validateSize(cols, rows);

    const process = this.spawn(this.executable, [...this.args], {
      cwd: options.cwd,
      cols,
      rows,
      name: 'xterm-256color',
      env: { ...globalThis.process.env },
    });

    const binding = { id: options.id, generation: randomUUID() };

    const session: Session = {
      binding,
      process,
      subscriptions: new Set(),
      stopping: false,
      exitListeners: new Set(),
    };

    this.sessions.set(binding.id, session);

    const exit = process.onExit((event) => {
      const listeners = [...session.exitListeners];

      this.release(session);

      for (const listener of listeners) {
        listener(event);
      }
    });

    session.subscriptions.add(exit);

    return { ...binding };
  }

  /** Invoke only after the local hook identifies the child session. Returns a fresh remote lease. */
  confirmSession(binding: PtyBinding, claudeSessionId: string): RemotePtyBinding {
    const session = this.local(binding);

    if (typeof claudeSessionId !== 'string' || !claudeSessionId || claudeSessionId.length > 512) {
      throw new CodedError(DaemonErrorCode.INVALID_CLAUDE_SESSION);
    }

    const remote = { ...session.binding, claudeSessionId, lease: randomUUID() };

    session.remote = remote;

    return { ...remote };
  }

  sendPrompt(binding: RemotePtyBinding, text: string): void {
    validatePrompt(text);
    this.remote(binding).process.write(`\x1b[200~${text}\x1b[201~\r`);
  }

  interrupt(binding: RemotePtyBinding): void {
    this.remote(binding).process.write('\x1b');
  }

  pressEnter(binding: RemotePtyBinding): void {
    this.remote(binding).process.write('\r');
  }

  /** Types text as keystrokes, then presses a key, as someone at the terminal would. */
  type(binding: RemotePtyBinding, input: { text?: string | undefined; key?: TerminalKey | undefined }): void {
    const session = this.remote(binding);

    if (input.text) {
      session.process.write(input.text);
    }

    if (input.key) {
      session.process.write(TERMINAL_KEY_BYTES[input.key]);
    }
  }

  disconnectRemote(binding: PtyBinding): void {
    delete this.local(binding).remote;
  }

  writeLocal(binding: PtyBinding, text: string): void {
    this.local(binding).process.write(text);
  }

  resize(binding: PtyBinding, cols: number, rows: number): void {
    this.validateSize(cols, rows);
    this.local(binding).process.resize(cols, rows);
  }

  onData(binding: PtyBinding, listener: (text: string) => void): Disposable {
    const session = this.local(binding);
    const subscription = session.process.onData(listener);

    session.subscriptions.add(subscription);

    return {
      dispose: () => {
        subscription.dispose();
        session.subscriptions.delete(subscription);
      },
    };
  }

  onExit(binding: PtyBinding, listener: (event: { exitCode: number; signal?: number }) => void): Disposable {
    const session = this.local(binding);

    session.exitListeners.add(listener);

    return {
      dispose: () => {
        session.exitListeners.delete(listener);
      },
    };
  }

  stop(binding: PtyBinding): void {
    const session = this.local(binding);

    this.stopSession(session);
  }

  close(): void {
    this.closed = true;
    const errors: unknown[] = [];

    for (const session of [...this.sessions.values()]) {
      try {
        this.stopSession(session);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length) {
      throw new AggregateError(errors, 'PTY_CLOSE_FAILED');
    }
  }

  private local(binding: PtyBinding): Session {
    const session = binding && this.sessions.get(binding.id);

    if (!session || session.stopping || session.binding.generation !== binding.generation) {
      throw new CodedError(ErrorCode.STALE_PTY_BINDING);
    }

    return session;
  }

  private remote(binding: RemotePtyBinding): Session {
    const session = this.local(binding);

    if (
      !session.remote ||
      session.remote.claudeSessionId !== binding.claudeSessionId ||
      session.remote.lease !== binding.lease
    ) {
      throw new CodedError(ErrorCode.STALE_PTY_BINDING);
    }

    return session;
  }

  private validateSize(cols: number, rows: number): void {
    if (![cols, rows].every((value) => Number.isSafeInteger(value) && value > 0 && value <= 500)) {
      throw new CodedError(DaemonErrorCode.INVALID_PTY_SIZE);
    }
  }

  private stopSession(session: Session): void {
    session.stopping = true;
    delete session.remote;
    // Keep it counted/owned until onExit; a child may ignore SIGHUP/SIGTERM.
    // This is explicit local teardown, never a remote disconnect operation.
    session.process.kill('SIGKILL');
  }

  private release(session: Session): void {
    if (this.sessions.get(session.binding.id) !== session) {
      return;
    }

    this.sessions.delete(session.binding.id);
    delete session.remote;

    for (const subscription of session.subscriptions) {
      subscription.dispose();
    }

    session.subscriptions.clear();
    session.exitListeners.clear();
  }
}
