import { DaemonErrorCode } from '../../error-codes.js';
import { RuleGuard, ruleHookOutput, type RuleStop } from '../../rules/check.js';
import {
  AttachmentMode,
  CodedError,
  CommandStatus,
  ConnectorId,
  ConnectorTransport,
  ErrorCode,
  IntegrationState,
  TargetKind,
  type Session,
} from '@protocol';

import { DesktopMode } from '../../domain/desktop.js';
import { HookAgent, IpcMessageType, PrimaryHookMessageTypes, WrapperActionType } from '../../domain/ipc.js';
import { RuntimeEvent, SourceVersion } from '../../domain/runtime.js';
import { ClaudeHookEvent } from '../../domain/claude.js';
import { attachmentPrompt } from '../../attachments/content/input.js';
import { codexConnectionSchema, type CodexConnection } from '../../domain/codex/connection.js';
import { cmuxContextSchema, cmuxSurfaceSchema, type CmuxContext } from '../../cmux/context.js';
import { cmuxAttacher } from '../../cmux/attach.js';
import { createServer, type Socket } from 'node:net';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { type HookEnvelope, type MonitorPort, hookSchema } from '../../domain/ports/monitor.js';
import { SourceAdapter, type AdapterRegistry, type DispatchReceipt } from '../../adapters/registry.js';
import { PermissionBroker, permissionHookOutput } from '../../commands/permission-broker.js';
import { bindHookSocket } from './hook-socket.js';
import { lineReader, writeFrame } from './ipc.js';
import { logDebug } from '../../diagnostics/log.js';

type WrapperReply = DispatchReceipt & { text?: string };

export interface HookSocketOptions {
  path: string;
  token: string;
  /** Message types this socket accepts; others get the rejection reply with no side effects. */
  allowedTypes?: readonly IpcMessageType[];
  /** Enables ReleaseHookSocket: the socket unbinds, replies, then this runs once the requester disconnects. */
  onRelease?: () => void;
}

interface Options extends HookSocketOptions {
  monitor: MonitorPort;
  adapters: AdapterRegistry;
  permissions: PermissionBroker;
  /** Stops shell commands an owner's rule covers; works whether or not remote permissions are on. */
  rules?: RuleGuard;
  inputEnabled: boolean;
  permissionsEnabled: boolean;
  onTranscript?: (sessionId: string, path: string) => void;
  /** Attaches hooks from cmux-started sessions to their surface; defaults to the cmux CLI. */
  attachCmux?: ReturnType<typeof cmuxAttacher>;
  onCodexConnect?: (selection: CodexConnection) => Promise<unknown>;
  onDesktopBind?: (mode: DesktopMode) => Promise<unknown>;
}

const authenticated = z.object({
  token: z.string().min(1).max(512),
  type: z.enum([
    IpcMessageType.Hook,
    IpcMessageType.Wrapper,
    IpcMessageType.DesktopBind,
    IpcMessageType.CodexConnect,
    IpcMessageType.ReleaseHookSocket,
  ]),
  wrapperId: z.string().uuid().optional(),
  cmux: cmuxContextSchema.optional(),
  cmuxSurface: cmuxSurfaceSchema.optional(),
  sourceVersion: z.string().max(128).optional(),
  mode: z.enum([DesktopMode.Chat, DesktopMode.Code]).optional(),
  payload: z.unknown().optional(),
  agent: z.enum(HookAgent).optional(),
  codex: codexConnectionSchema.optional(),
});

const RejectionReply: Partial<Record<string, IpcMessageType>> = {
  [IpcMessageType.DesktopBind]: IpcMessageType.DesktopResult,
  [IpcMessageType.CodexConnect]: IpcMessageType.CodexResult,
  [IpcMessageType.ReleaseHookSocket]: IpcMessageType.ReleaseResult,
};

export async function startHookServer(options: Options) {
  const allowedTypes: readonly IpcMessageType[] = options.allowedTypes ?? PrimaryHookMessageTypes;

  const attachCmux =
    options.attachCmux ??
    cmuxAttacher({
      adapters: options.adapters,
      inputEnabled: options.inputEnabled,
      permissionsEnabled: options.permissionsEnabled,
    });

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
        reject(new CodedError(ErrorCode.STALE_SESSION));

        return;
      }

      const id = randomUUID();

      const timer = setTimeout(() => {
        wrapper.pending.delete(id);
        reject(new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE));
      }, 5000);

      wrapper.pending.set(id, { resolve, reject, timer });
      writeFrame(wrapper.socket, { type: IpcMessageType.Request, id, action });
    });

  const server = createServer((socket) => {
    sockets.add(socket);
    let wrapperId: string | undefined;
    let busy = false;
    const authTimer = setTimeout(() => socket.destroy(), 5000);

    socket.on('error', (error) => logDebug('code/hooks/hook-server', error));

    socket.on('close', () => {
      clearTimeout(authTimer);
      sockets.delete(socket);

      if (wrapperId) {
        const wrapper = wrappers.get(wrapperId);

        if (wrapper?.socket === socket) {
          wrappers.delete(wrapperId);

          for (const pending of wrapper.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE));
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
          throw new CodedError(ErrorCode.IPC_BUSY);
        }

        busy = true;
        const message = authenticated.parse(raw);

        if (!allowedTypes.includes(message.type)) {
          throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
        }

        const token = Buffer.from(message.token),
          expected = Buffer.from(options.token);

        if (token.length !== expected.length || !timingSafeEqual(token, expected)) {
          throw new CodedError(ErrorCode.UNAUTHORIZED);
        }

        clearTimeout(authTimer);

        if (message.type === IpcMessageType.ReleaseHookSocket) {
          const onRelease = options.onRelease;

          if (!onRelease) {
            throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
          }

          await binding.unbind();
          writeFrame(socket, { type: IpcMessageType.ReleaseResult });
          socket.once('close', () => onRelease());
          socket.end();

          return;
        }

        if (message.type === IpcMessageType.CodexConnect) {
          if (!message.codex || !options.onCodexConnect) {
            throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
          }

          const result = await options.onCodexConnect(message.codex);

          writeFrame(socket, { type: IpcMessageType.CodexResult, result });
          socket.end();

          return;
        }

        if (message.type === IpcMessageType.DesktopBind) {
          if (!message.mode || !options.onDesktopBind) {
            throw new CodedError(ErrorCode.DESKTOP_UNAVAILABLE);
          }

          const result = await options.onDesktopBind(message.mode);

          writeFrame(socket, { type: IpcMessageType.DesktopResult, result });
          socket.end();

          return;
        }

        if (message.type === IpcMessageType.Wrapper) {
          if (!message.wrapperId || wrappers.has(message.wrapperId)) {
            throw new CodedError(DaemonErrorCode.INVALID_WRAPPER);
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
                    throw new CodedError(response.code ?? ErrorCode.WRAPPER_FAILED);
                  }

                  return response;
                },
                interrupt: async (_binding) => {
                  const response = await call(id, {
                    type: WrapperActionType.Interrupt,
                    sessionId: wrappers.get(id)?.claudeSessionId ?? '',
                  });

                  if (response.status !== CommandStatus.Dispatched) {
                    throw new CodedError(response.code ?? ErrorCode.WRAPPER_FAILED);
                  }

                  return response;
                },
                screen: async () => {
                  const response = await call(id, { type: WrapperActionType.Snapshot });

                  if (typeof response.text !== 'string') {
                    throw new CodedError(ErrorCode.SNAPSHOT_UNAVAILABLE);
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
              throw new CodedError(DaemonErrorCode.BINDING_FAILED);
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

        /** Holds the command until the owner answers the rule stop; another daemon's answer closes this socket. */
        const answerRule = async (
          stop: RuleStop,
          input: HookEnvelope,
          session: Session,
          agent: HookAgent,
        ) => {
          socket.once('close', () => options.permissions.cancelSession(session.id, session.generation));
          options.monitor.emit(RuntimeEvent.Snapshot);

          const decision = await options.rules!.ask(stop, input, session);

          if (!socket.destroyed) {
            writeFrame(socket, {
              type: IpcMessageType.HookResult,
              output: ruleHookOutput(decision, stop.rule, agent),
              settled: true,
            });
          }

          options.monitor.emit(RuntimeEvent.Snapshot);
        };

        // A Codex hook only gates a command against the owner's rules; its session reports through Codex itself.
        if (message.agent === HookAgent.Codex) {
          const session = options.monitor
            .snapshot()
            .sessions.find((item) => 'threadId' in item.target && item.target.threadId === hook.session_id);

          const stop = session && options.rules ? await options.rules.check(hook, session) : null;

          if (stop && session) {
            await answerRule(stop, hook, session, HookAgent.Codex);
          } else {
            writeFrame(socket, { type: IpcMessageType.HookResult, output: {} });
          }

          socket.end();

          return;
        }

        const deviceId =
          options.monitor.snapshot().sessions[0]?.target.deviceId ?? options.adapters.deviceIdentity();

        const attached =
          !(message.wrapperId && wrappers.has(message.wrapperId)) && message.cmuxSurface
            ? await attachCmux(message.cmuxSurface, deviceId)
            : undefined;

        const wrapped = message.wrapperId && wrappers.has(message.wrapperId) ? message.wrapperId : undefined;
        const connector = attached?.connectorId ?? wrapped ?? ConnectorId.Native;

        if (hook.hook_event_name === ClaudeHookEvent.SessionStart && wrappers.has(connector)) {
          wrappers.get(connector)!.claudeSessionId = hook.session_id;
          const bound = await call(connector, { type: WrapperActionType.Bind, sessionId: hook.session_id });

          if (bound.status !== CommandStatus.Dispatched) {
            throw new CodedError(DaemonErrorCode.BINDING_FAILED);
          }
        }

        const cmux = wrappers.get(connector)?.cmux;

        options.monitor.ingestHook(
          hook,
          connector,
          attached ??
            (cmux ? { kind: TargetKind.Cmux, deviceId, connectorId: connector, ...cmux } : undefined),
          // The hook runs as a child of the Claude process, so its surface is that session's terminal.
          attached ? { verifiedTerminal: true } : undefined,
        );

        const session = options.monitor.findClaude(connector, hook.session_id)!;

        if (hook.transcript_path) {
          options.onTranscript?.(session.id, hook.transcript_path);
        }

        const stop =
          hook.hook_event_name === ClaudeHookEvent.PreToolUse && options.rules
            ? await options.rules.check(hook, session)
            : null;

        if (stop) {
          await answerRule(stop, hook, session, HookAgent.Claude);
        } else if (hook.hook_event_name === ClaudeHookEvent.PermissionRequest && options.permissionsEnabled) {
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
          const decision = await answer;

          if (hook.agent_id) {
            options.monitor.settleSubagentPermission(session.id, hook.agent_id, decision);
          }

          writeFrame(socket, { type: IpcMessageType.HookResult, output: permissionHookOutput(decision) });
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

            const reply = RejectionReply[String((raw as { type?: string })?.type)];

            writeFrame(
              socket,
              reply ? { type: reply, code } : { type: IpcMessageType.HookResult, output: {} },
            );

            socket.end();
          } catch {
            socket.destroy();
          }
        }
      });
    });
  });

  const binding = await bindHookSocket(server, options.path);

  return {
    async close() {
      closing = true;

      for (const socket of sockets) {
        socket.destroy();
      }

      await binding.close();
    },
  };
}
