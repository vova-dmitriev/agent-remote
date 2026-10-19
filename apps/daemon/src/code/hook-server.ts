import { DaemonErrorCode } from '../error-codes.js';
import {
  ErrorCode,
  ConnectorId,
  TargetKind,
  ConnectorTransport,
  AttachmentMode,
  IntegrationState,
  CommandStatus,
} from '@protocol';

import { DesktopMode } from '../domain/desktop.js';
import { IpcMessageType, WrapperActionType } from '../domain/ipc.js';
import { RuntimeEvent, SourceVersion } from '../domain/runtime.js';
import { ClaudeHookEvent } from '../domain/claude.js';
import { attachmentPrompt } from '../attachments/input.js';
import { codexConnectionSchema, type CodexConnection } from '../codex/manager.js';
import { cmuxContextSchema, type CmuxContext } from '../cmux/context.js';
import { createServer, type Socket } from 'node:net';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { type Monitor, hookSchema } from '../monitor/monitor.js';
import { SourceAdapter, type AdapterRegistry, type DispatchReceipt } from '../adapters/registry.js';
import { PermissionBroker, permissionHookOutput } from '../commands/permission-broker.js';
import { lineReader, writeFrame } from './ipc.js';

type WrapperReply = DispatchReceipt & { text?: string };

interface Options {
  path: string;
  token: string;
  monitor: Monitor;
  adapters: AdapterRegistry;
  permissions: PermissionBroker;
  inputEnabled: boolean;
  permissionsEnabled: boolean;
  onTranscript?: (sessionId: string, path: string) => void;
  onCodexConnect?: (selection: CodexConnection) => Promise<unknown>;
  onDesktopBind?: (mode: DesktopMode) => Promise<unknown>;
}

const authenticated = z.object({
  token: z.string().max(512),
  type: z.enum([
    IpcMessageType.Hook,
    IpcMessageType.Wrapper,
    IpcMessageType.DesktopBind,
    IpcMessageType.CodexConnect,
  ]),
  wrapperId: z.string().uuid().optional(),
  cmux: cmuxContextSchema.optional(),
  sourceVersion: z.string().max(128).optional(),
  mode: z.enum([DesktopMode.Chat, DesktopMode.Code]).optional(),
  payload: z.unknown().optional(),
  codex: codexConnectionSchema.optional(),
});

export async function startHookServer(options: Options) {
  try {
    const info = await lstat(options.path);

    if (!info.isSocket()) {
      throw new Error(DaemonErrorCode.SOCKET_PATH_IN_USE);
    }

    const probe = await import('node:net');

    const alive = await new Promise<boolean>((resolve) => {
      const socket = probe.connect(options.path);

      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.once('error', () => resolve(false));
    });

    if (alive) {
      throw new Error(DaemonErrorCode.DAEMON_ALREADY_RUNNING);
    }

    await unlink(options.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  let closing = false;
  const sockets = new Set<Socket>();

  const wrappers = new Map<
    string,
    {
      socket: Socket;
      cmux?: CmuxContext;
      claudeSessionId?: string;
      pending: Map<
        string,
        {
          resolve: (value: WrapperReply) => void;
          reject: (error: Error) => void;
          timer: ReturnType<typeof setTimeout>;
        }
      >;
    }
  >();

  const call = (wrapperId: string, action: unknown) =>
    new Promise<WrapperReply>((resolve, reject) => {
      const wrapper = wrappers.get(wrapperId);

      if (!wrapper) {
        reject(new Error(ErrorCode.STALE_SESSION));

        return;
      }

      const id = randomUUID();

      const timer = setTimeout(() => {
        wrapper.pending.delete(id);
        reject(new Error(ErrorCode.UNKNOWN_AFTER_WRITE));
      }, 5000);

      wrapper.pending.set(id, { resolve, reject, timer });
      writeFrame(wrapper.socket, { type: IpcMessageType.Request, id, action });
    });

  const server = createServer((socket) => {
    sockets.add(socket);
    let wrapperId: string | undefined;
    let busy = false;
    const authTimer = setTimeout(() => socket.destroy(), 5000);

    socket.on('error', () => {});

    socket.on('close', () => {
      clearTimeout(authTimer);
      sockets.delete(socket);

      if (wrapperId) {
        const wrapper = wrappers.get(wrapperId);

        if (wrapper?.socket === socket) {
          wrappers.delete(wrapperId);

          for (const pending of wrapper.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(ErrorCode.UNKNOWN_AFTER_WRITE));
          }

          void options.adapters.disconnect(wrapperId);

          if (!closing) {
            options.monitor.invalidate(wrapperId);
          }
        }
      }
    });

    lineReader(socket, (raw) => {
      void (async () => {
        if (wrapperId) {
          const message = z
            .strictObject({ type: z.literal(IpcMessageType.Response), id: z.string(), result: z.unknown() })
            .parse(raw);

          const wrapper = wrappers.get(wrapperId);
          const pending = wrapper?.pending.get(message.id);

          if (pending) {
            wrapper!.pending.delete(message.id);
            clearTimeout(pending.timer);
            pending.resolve(message.result as WrapperReply);
          }

          return;
        }

        if (busy) {
          throw new Error(ErrorCode.IPC_BUSY);
        }

        busy = true;
        const message = authenticated.parse(raw);

        const token = Buffer.from(message.token),
          expected = Buffer.from(options.token);

        if (token.length !== expected.length || !timingSafeEqual(token, expected)) {
          throw new Error(ErrorCode.UNAUTHORIZED);
        }

        clearTimeout(authTimer);

        if (message.type === IpcMessageType.CodexConnect) {
          if (!message.codex || !options.onCodexConnect) {
            throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE);
          }

          const result = await options.onCodexConnect(message.codex);

          writeFrame(socket, { type: IpcMessageType.CodexResult, result });
          socket.end();

          return;
        }

        if (message.type === IpcMessageType.DesktopBind) {
          if (!message.mode || !options.onDesktopBind) {
            throw new Error(ErrorCode.DESKTOP_UNAVAILABLE);
          }

          const result = await options.onDesktopBind(message.mode);

          writeFrame(socket, { type: IpcMessageType.DesktopResult, result });
          socket.end();

          return;
        }

        if (message.type === IpcMessageType.Wrapper) {
          if (!message.wrapperId || wrappers.has(message.wrapperId)) {
            throw new Error(DaemonErrorCode.INVALID_WRAPPER);
          }

          wrapperId = message.wrapperId;

          wrappers.set(wrapperId, {
            socket,
            pending: new Map(),
            ...(message.cmux ? { cmux: message.cmux } : {}),
          });

          const id = wrapperId;

          options.adapters.register(
            new SourceAdapter(
              {
                connectorId: id,
                kind: message.cmux ? TargetKind.Cmux : TargetKind.ClaudeCodeCli,
                transport: message.cmux ? ConnectorTransport.Cmux : ConnectorTransport.Pty,
                sourceVersion: message.sourceVersion ?? SourceVersion.Unknown,
                capabilities: {
                  observe: true,
                  history: true,
                  prompt: options.inputEnabled,
                  interrupt: options.inputEnabled,
                  permission: options.permissionsEnabled,
                  terminalSnapshot: !!message.cmux,
                  ...(options.inputEnabled
                    ? { attachments: { images: AttachmentMode.Reference, files: AttachmentMode.Reference } }
                    : {}),
                },
                state: IntegrationState.Ready,
                reason: null,
              },
              {
                prompt: async (_binding, text, attachments = []) => {
                  const response = await call(id, {
                    type: WrapperActionType.Prompt,
                    sessionId: wrappers.get(id)?.claudeSessionId ?? '',
                    text: attachmentPrompt(text, attachments),
                  });

                  if (response.status !== CommandStatus.Dispatched) {
                    throw new Error(response.code ?? 'WRAPPER_FAILED');
                  }

                  return response;
                },
                interrupt: async (_binding) => {
                  const response = await call(id, {
                    type: WrapperActionType.Interrupt,
                    sessionId: wrappers.get(id)?.claudeSessionId ?? '',
                  });

                  if (response.status !== CommandStatus.Dispatched) {
                    throw new Error(response.code ?? 'WRAPPER_FAILED');
                  }

                  return response;
                },
                screen: async () => {
                  const response = await call(id, { type: WrapperActionType.Snapshot });

                  if (typeof response.text !== 'string') {
                    throw new Error(ErrorCode.SNAPSHOT_UNAVAILABLE);
                  }

                  return response.text;
                },
              },
            ),
          );

          writeFrame(socket, { type: IpcMessageType.Registered });
          const saved = options.monitor.managedRegistration(id, message.cmux);

          if (saved) {
            const bound = await call(id, {
              type: WrapperActionType.Bind,
              sessionId: saved.session.claudeSessionId,
            });

            if (bound.status !== CommandStatus.Dispatched) {
              throw new Error(DaemonErrorCode.BINDING_FAILED);
            }

            wrappers.get(id)!.claudeSessionId = saved.session.claudeSessionId!;
            options.monitor.restoreManaged(saved.session);

            if (saved.transcriptPath) {
              options.onTranscript?.(saved.session.id, saved.transcriptPath);
            }
          }

          options.monitor.emit(RuntimeEvent.Snapshot);

          return;
        }

        const hook = hookSchema.parse(message.payload);

        const connector =
          message.wrapperId && wrappers.has(message.wrapperId) ? message.wrapperId : ConnectorId.Native;

        if (hook.hook_event_name === ClaudeHookEvent.SessionStart && connector !== ConnectorId.Native) {
          wrappers.get(connector)!.claudeSessionId = hook.session_id;
          const bound = await call(connector, { type: WrapperActionType.Bind, sessionId: hook.session_id });

          if (bound.status !== CommandStatus.Dispatched) {
            throw new Error(DaemonErrorCode.BINDING_FAILED);
          }
        }

        const cmux = wrappers.get(connector)?.cmux;

        options.monitor.ingestHook(
          hook,
          connector,
          cmux
            ? {
                kind: TargetKind.Cmux,
                deviceId:
                  options.monitor.snapshot().sessions[0]?.target.deviceId ??
                  options.adapters.deviceIdentity(),
                connectorId: connector,
                ...cmux,
              }
            : undefined,
        );

        const session = options.monitor.findClaude(connector, hook.session_id)!;

        if (hook.transcript_path) {
          options.onTranscript?.(session.id, hook.transcript_path);
        }

        if (hook.hook_event_name === ClaudeHookEvent.PermissionRequest && options.permissionsEnabled) {
          const answer = options.permissions.open({
            requestId: randomUUID(),
            sessionId: session.id,
            generation: session.generation,
            toolName: hook.tool_name ?? 'Tool',
            input: hook.tool_input ?? {},
            expiresAt: Date.now() + 45000,
          });

          socket.once('close', () => options.permissions.cancelSession(session.id, session.generation));
          options.monitor.emit(RuntimeEvent.Snapshot);
          writeFrame(socket, { type: IpcMessageType.HookResult, output: permissionHookOutput(await answer) });
          options.monitor.emit(RuntimeEvent.Snapshot);
        } else {
          writeFrame(socket, { type: IpcMessageType.HookResult, output: {} });
        }

        socket.end();
      })().catch((error) => {
        if (!socket.destroyed) {
          try {
            const code =
              error instanceof Error && /^[A-Z_]+$/.test(error.message)
                ? error.message
                : 'DESKTOP_UNAVAILABLE';

            writeFrame(
              socket,
              [IpcMessageType.DesktopBind, IpcMessageType.CodexConnect].some(
                (candidateValue) => candidateValue === String((raw as { type?: string })?.type),
              )
                ? {
                    type:
                      (raw as { type?: string })?.type === IpcMessageType.CodexConnect
                        ? IpcMessageType.CodexResult
                        : IpcMessageType.DesktopResult,
                    code,
                  }
                : { type: IpcMessageType.HookResult, output: {} },
            );

            socket.end();
          } catch {
            socket.destroy();
          }
        }
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);

    server.listen(options.path, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  await chmod(options.path, 0o600);

  return {
    async close() {
      closing = true;

      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve) => server.close(() => resolve()));

      try {
        await unlink(options.path);
      } catch {}
    },
  };
}
