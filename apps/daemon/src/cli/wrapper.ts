import { ErrorCode, CommandStatus, TargetKind } from '@protocol';
import { WrapperActionType, IpcMessageType } from '../domain/ipc.js';
import { CmuxClient } from '../cmux/client.js';
import { type CmuxContext } from '../cmux/context.js';
import { loadConfig, localSecret, socketPath } from '../config.js';
import { connect, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PtySessionManager, type RemotePtyBinding } from '../code/pty-session-manager.js';
import { parseClaudeArgs } from './arguments.js';
import { lineReader, writeFrame } from '../code/hooks/ipc.js';

const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal(WrapperActionType.Bind), sessionId: z.string().min(1).max(512) }),
  z.strictObject({
    type: z.literal(WrapperActionType.Prompt),
    sessionId: z.string().min(1).max(512),
    text: z.string(),
  }),
  z.strictObject({ type: z.literal(WrapperActionType.Interrupt), sessionId: z.string().min(1).max(512) }),
  z.strictObject({ type: z.literal(WrapperActionType.Snapshot) }),
]);

export async function startClaude(
  argv: string[],
  terminal: { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream } = {
    stdin: process.stdin,
    stdout: process.stdout,
  },
  cmux?: CmuxContext,
  launch?: { executable: string; args: string[] },
): Promise<number> {
  const args = launch?.args ?? parseClaudeArgs(argv);
  const config = cmux ? await loadConfig() : undefined;

  const cmuxClient = cmux
    ? new CmuxClient({
        executable: process.env.CMUX_CLI ?? '/Applications/cmux.app/Contents/Resources/bin/cmux',
      })
    : undefined;

  const token = await localSecret(),
    wrapperId = process.env.CLAUDE_REMOTE_LAUNCH_ID
      ? z.uuid().parse(process.env.CLAUDE_REMOTE_LAUNCH_ID)
      : randomUUID();

  delete process.env.CLAUDE_REMOTE_LAUNCH_ID;
  const manager = new PtySessionManager({ args, ...(launch ? { executable: launch.executable } : {}) });
  let remote: RemotePtyBinding | undefined;
  let socket: Socket | undefined;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  let firstReady!: () => void;

  const firstConnection = new Promise<void>((resolve) => {
    firstReady = resolve;
  });

  const connectRemote = () => {
    if (stopped) {
      return;
    }

    const connection = connect(socketPath());

    socket = connection;

    connection.on('connect', () =>
      writeFrame(connection, {
        type: IpcMessageType.Wrapper,
        token,
        wrapperId,
        sourceVersion: 'local-claude',
        ...(cmux ? { cmux } : {}),
      }),
    );

    connection.on('error', () => firstReady());

    connection.on('close', () => {
      remote = undefined;

      try {
        manager.disconnectRemote(local);
      } catch {}

      if (!stopped) {
        retry = setTimeout(connectRemote, 1000);
      }
    });

    lineReader(connection, (raw) => {
      void (async () => {
        const message = raw as { type?: string; id?: string; action?: unknown };

        if (message.type === IpcMessageType.Registered) {
          firstReady();

          return;
        }

        if (message.type !== IpcMessageType.Request || typeof message.id !== 'string') {
          return;
        }

        let result: unknown;

        try {
          const action = actionSchema.parse(message.action);

          if (action.type === WrapperActionType.Snapshot) {
            if (!cmux || !cmuxClient || !config) {
              throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE);
            }

            result = {
              status: CommandStatus.Dispatched,
              text: await cmuxClient.readScreen({
                kind: TargetKind.Cmux,
                deviceId: config.deviceId,
                connectorId: wrapperId,
                ...cmux,
              }),
            };
          } else if (action.type === WrapperActionType.Bind) {
            remote = manager.confirmSession(local, action.sessionId);
            result = { status: CommandStatus.Dispatched };
          } else {
            if (!remote || remote.claudeSessionId !== action.sessionId) {
              throw new Error(ErrorCode.STALE_SESSION);
            }

            if (action.type === WrapperActionType.Prompt) {
              manager.sendPrompt(remote, action.text);
            } else {
              manager.interrupt(remote);
            }

            result = { status: CommandStatus.Dispatched };
          }
        } catch (error) {
          result = {
            status: CommandStatus.Rejected,
            code:
              error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INVALID_COMMAND',
          };
        }

        writeFrame(connection, { type: IpcMessageType.Response, id: message.id, result });
      })().catch(() => connection.destroy());
    });
  };

  connectRemote();
  const firstTimeout = setTimeout(firstReady, 2000);

  await firstConnection;
  clearTimeout(firstTimeout);
  const saved = process.env.CLAUDE_REMOTE_WRAPPER_ID;

  process.env.CLAUDE_REMOTE_WRAPPER_ID = wrapperId;

  const local = manager.start({
    id: wrapperId,
    cwd: process.cwd(),
    cols: terminal.stdout.columns || 80,
    rows: terminal.stdout.rows || 24,
  });

  if (saved === undefined) {
    delete process.env.CLAUDE_REMOTE_WRAPPER_ID;
  } else {
    process.env.CLAUDE_REMOTE_WRAPPER_ID = saved;
  }

  const output = manager.onData(local, (text) => terminal.stdout.write(text));
  const wasRaw = terminal.stdin.isRaw;

  const data = (chunk: Buffer) => {
    try {
      manager.writeLocal(local, chunk.toString('utf8'));
    } catch {}
  };

  const resize = () => {
    try {
      manager.resize(local, terminal.stdout.columns || 80, terminal.stdout.rows || 24);
    } catch {}
  };

  if (terminal.stdin.isTTY) {
    terminal.stdin.setRawMode(true);
  }

  terminal.stdin.on('data', data);
  terminal.stdin.resume();
  terminal.stdout.on('resize', resize);

  return new Promise<number>((resolve) => {
    manager.onExit(local, (event) => {
      stopped = true;

      if (retry) {
        clearTimeout(retry);
      }

      socket?.destroy();
      terminal.stdin.removeListener('data', data);
      terminal.stdout.removeListener('resize', resize);

      if (terminal.stdin.isTTY) {
        terminal.stdin.setRawMode(wasRaw ?? false);
      }

      terminal.stdin.pause();
      output.dispose();
      resolve(event.exitCode);
    });
  });
}
