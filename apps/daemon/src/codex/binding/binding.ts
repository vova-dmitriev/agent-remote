import { DaemonErrorCode } from '../../error-codes.js';
import {
  CodexItemStatus,
  CodexItemsView,
  CodexSortDirection,
  CodexMethod,
  CodexRuntimeStatus,
  CodexItemType,
  CodexTurnStatus,
  CodexActiveFlag,
  CodexContentType,
} from '../../domain/codex/codex.js';
import {
  AttachmentMode,
  BindingState,
  CodedError,
  CommandStatus,
  ConnectorTransport,
  ErrorCode,
  EventType,
  type HistoryMessage,
  IntegrationState,
  MessageRole,
  PromptDelivery,
  type Session,
  sessionSchema,
  SessionStatus,
  StatusConfidence,
  TargetKind,
} from '@protocol';
import { RuntimeEvent } from '../../domain/runtime.js';
import { CodexFileChanges } from './file-changes.js';
import { codexCurrentStep } from '../history/current-step.js';
import { clearCurrentStep } from '../../monitor/activity/current-step.js';
import { codexMediaCandidate, nativeCodexMedia } from '../../attachments/content/native.js';
import { codexAttachmentInput } from '../../attachments/content/input.js';
import { type AttachmentService } from '../../attachments/service.js';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { SourceAdapter, type AdapterRegistry } from '../../adapters/registry.js';
import { type PermissionBroker } from '../../commands/permission-broker.js';
import { type Monitor } from '../../monitor/monitor.js';
import { type RpcFrame } from '../rpc/rpc-client.js';
import { codexTurnError } from '../errors.js';
import { CodexModelReader } from '../history/model-reader.js';
import { type UserInputBroker } from '../../commands/user-input-broker.js';
import { CodexSubagents } from './subagents.js';
import { CodexUserInputs } from './user-inputs.js';
import { CodexApprovals } from './approvals.js';
import { historyTurnTimes, messageTime, turnTime } from '../history/history-times.js';
import { object, itemMessage } from '../events.js';
import { codexSessionIdentity } from './identity.js';

export interface CodexClient extends EventEmitter {
  request(method: string, params: unknown): Promise<unknown>;
  respond(id: string | number, result: unknown): void | Promise<void>;
  reject?(id: string | number): void;
  pendingRequests?(): RpcFrame[];
  close(): Promise<void>;
}
export interface CodexBindingOptions {
  kind: typeof TargetKind.CodexCli | typeof TargetKind.CodexDesktop;
  threadId: string;
  endpoint: string;
}
interface Dependencies {
  rpc: CodexClient;
  monitor: Monitor;
  adapters: AdapterRegistry;
  permissions: PermissionBroker;
  userInputs?: UserInputBroker;
  inputEnabled: boolean;
  permissionsEnabled: boolean;
  attachments?: AttachmentService;
  codexHome?: string;
}

export async function bindCodex(options: CodexBindingOptions, deps: Dependencies) {
  const { rpc, monitor, adapters, permissions } = deps;

  await deps.attachments?.ready();
  const loaded = object(await rpc.request(CodexMethod.ThreadLoadedList, {}));

  if (!Array.isArray(loaded.data) || !loaded.data.includes(options.threadId)) {
    throw new CodedError(ErrorCode.CODEX_THREAD_NOT_LOADED);
  }

  const metadata = object(
    object(await rpc.request(CodexMethod.ThreadRead, { threadId: options.threadId })).thread,
  );

  if (metadata.id !== options.threadId) {
    throw new CodedError(DaemonErrorCode.CODEX_THREAD_MISMATCH);
  }

  const { sessionId, connectorId, target } = codexSessionIdentity(options, adapters.deviceIdentity());

  const accepts = metadata.canAcceptDirectInput === true;
  const statusType = object(metadata.status).type;
  let initialStatus: Session['status'] = SessionStatus.Unknown;

  if (statusType === CodexRuntimeStatus.Active) {
    initialStatus = SessionStatus.Running;
  } else if (statusType === CodexRuntimeStatus.Idle) {
    initialStatus = SessionStatus.Idle;
  }

  const session: Session = sessionSchema.parse({
    id: sessionId,
    target,
    claudeSessionId: null,
    ...(sessionSchema.shape.cwd.safeParse(metadata.cwd).success ? { cwd: metadata.cwd } : {}),
    generation: randomUUID(),
    title: typeof metadata.name === 'string' && metadata.name.trim() ? metadata.name : undefined,
    status: initialStatus,
    binding: BindingState.Verified,
    lastEventAt: Date.now(),
    capabilities: {
      observe: true,
      history: true,
      prompt: deps.inputEnabled && accepts,
      interrupt: deps.inputEnabled && accepts,
      permission: deps.permissionsEnabled && accepts,
      userInput: deps.inputEnabled && accepts && !!deps.userInputs,
      terminalSnapshot: false,
      ...(deps.inputEnabled && accepts
        ? { attachments: { images: AttachmentMode.Native, files: AttachmentMode.Reference } }
        : {}),
    },
    integrationState: IntegrationState.Ready,
    statusConfidence: StatusConfidence.Observed,
  });

  const binding = { target, generation: session.generation, localProof: randomUUID() };

  let activeTurn: string | null = null,
    closed = false;

  let lifecycleRevision = 0;
  let activityRevision = 0;
  let modelRevision = 0;
  const completedTurns = new Set<string>();
  const pendingFrames = new Map<string | number, RpcFrame>();
  const messages = new Map<string, string>();
  const liveText = new Map<string, string>();
  const deferred = new Map<string, HistoryMessage>();
  let hydrating = true;

  const changed = () => {
    if (session.status !== SessionStatus.Running) {
      clearCurrentStep(session);
    }

    monitor.emit(RuntimeEvent.Snapshot);
  };

  const approvals = new CodexApprovals(
    rpc,
    session,
    permissions,
    () => activeTurn,
    changed,
    session.capabilities.permission,
  );

  const userInputs = new CodexUserInputs(rpc, session, deps.userInputs, () => activeTurn, changed);

  let mediaQueue: Promise<void> = Promise.resolve(),
    drainingMedia = false,
    queuedBytes = 0;

  const queuedMedia: {
    key: string;
    fingerprint: string;
    size: number;
    record: unknown;
    message: HistoryMessage;
    historical: boolean;
    generation: string;
  }[] = [];

  const sourceFingerprints = new Map<string, string>();

  const publishMessage = (message: HistoryMessage | undefined, historical: boolean) => {
    if (!message || (!message.text && !message.attachments?.length)) {
      return;
    }

    if (historical && messages.has(message.id)) {
      return;
    }

    if (messages.get(message.id) === JSON.stringify([message.text, message.attachments])) {
      return;
    }

    if (message.role === MessageRole.Assistant) {
      liveText.set(message.id, message.text);

      if (liveText.size > 500) {
        liveText.delete(liveText.keys().next().value!);
      }
    }

    messages.delete(message.id);
    messages.set(message.id, JSON.stringify([message.text, message.attachments]));

    if (messages.size > 500) {
      messages.delete(messages.keys().next().value!);
    }

    if (!historical && hydrating) {
      deferred.set(message.id, message);

      if (deferred.size > 500) {
        deferred.delete(deferred.keys().next().value!);
      }

      return;
    }

    monitor.publish(session.id, EventType.Message, message);
  };

  const subagents = new CodexSubagents();
  const changes = new CodexFileChanges();

  session.changes = changes.value();

  const publishItem = (item: unknown, turnId: string, historical = false, occurredAt = Date.now()) => {
    if (closed) {
      return;
    }

    changes.ingest(item, turnId, historical);
    session.changes = changes.value();
    subagents.ingest(item, turnId, historical);
    monitor.setSubagents(session.id, subagents.values());
    const candidate = deps.attachments ? codexMediaCandidate(item) : undefined;
    const raw = object(item);

    const message =
      itemMessage(item, turnId, occurredAt) ??
      (candidate && typeof raw.id === 'string'
        ? {
            id: `${turnId}:${raw.id}`,
            role: raw.type === CodexItemType.UserMessage ? MessageRole.User : MessageRole.Assistant,
            text: '',
            occurredAt,
          }
        : undefined);

    if (!message || closed) {
      return;
    }

    if (!deps.attachments) {
      return publishMessage(message, historical);
    }

    const service = deps.attachments;

    if (!candidate) {
      return publishMessage(service.restore(session, message), historical);
    }

    const fingerprint = createHash('sha256').update(candidate.fingerprint).update(message.text).digest('hex');

    if (sourceFingerprints.get(message.id) === fingerprint) {
      return mediaQueue;
    }

    const existing = queuedMedia.findIndex((item) => item.key === message.id);

    if (existing !== -1) {
      queuedBytes -= queuedMedia[existing]!.size;
      queuedMedia.splice(existing, 1);
    }

    if (queuedMedia.length >= 64 || queuedBytes + candidate.size > 32 * 1024 * 1024) {
      return;
    }

    queuedMedia.push({
      key: message.id,
      fingerprint,
      size: candidate.size,
      record: candidate.record,
      message,
      historical,
      generation: session.generation,
    });

    queuedBytes += candidate.size;
    sourceFingerprints.delete(message.id);
    sourceFingerprints.set(message.id, fingerprint);

    if (sourceFingerprints.size > 500) {
      sourceFingerprints.delete(sourceFingerprints.keys().next().value!);
    }

    if (!drainingMedia) {
      drainingMedia = true;

      mediaQueue = (async () => {
        while (queuedMedia.length && !closed) {
          const work = queuedMedia.shift()!;

          queuedBytes -= work.size;

          const current = () =>
            !closed &&
            session.generation === work.generation &&
            session.integrationState === IntegrationState.Ready &&
            sourceFingerprints.get(work.key) === work.fingerprint;

          if (!current()) {
            continue;
          }

          try {
            const normalized = await service.normalize(
              session,
              work.message,
              nativeCodexMedia(work.record),
              current,
            );

            if (current() && (normalized.text || normalized.attachments?.length)) {
              publishMessage(normalized, work.historical);
            }
          } catch {
            if (current() && work.message.text) {
              publishMessage(work.message, work.historical);
            }
          }
        }
      })().finally(() => {
        drainingMedia = false;
      });
    }

    return mediaQueue;
  };

  const notification = (frame: RpcFrame) => {
    const params = object(frame.params);

    if (params.threadId !== options.threadId || closed) {
      return;
    }

    const turn = object(params.turn);

    if (
      frame.method === CodexMethod.TurnStarted &&
      typeof turn.id === 'string' &&
      !completedTurns.has(turn.id)
    ) {
      lifecycleRevision++;

      if (activeTurn !== turn.id) {
        userInputs.clear();
        clearCurrentStep(session);
      }

      activeTurn = turn.id;
      session.status = SessionStatus.Running;
      delete session.errorCode;
    }

    if (frame.method === CodexMethod.TurnCompleted && typeof turn.id === 'string') {
      lifecycleRevision++;

      if (!completedTurns.has(turn.id)) {
        completedTurns.add(turn.id);

        if (completedTurns.size > 100) {
          completedTurns.delete(completedTurns.values().next().value!);
        }

        if (!activeTurn || turn.id === activeTurn) {
          approvals.clear();
          userInputs.clear();
          activeTurn = null;
          clearCurrentStep(session);
          session.status = SessionStatus.Idle;

          if (turn.status === CodexTurnStatus.Failed) {
            session.errorCode = codexTurnError(turn.error);
          }

          monitor.publish(session.id, EventType.TurnEnd, { reason: turn.status });
        }
      }
    }

    if (frame.method === CodexMethod.ModelRerouted) {
      modelRevision++;
      monitor.setSessionModel(session.id, params.toModel);
    }

    if (frame.method === CodexMethod.ThreadModelUpdated && options.kind === TargetKind.CodexDesktop) {
      modelRevision++;
      monitor.setSessionModel(session.id, params.model);
    }

    if (frame.method === CodexMethod.ServerRequestResolved) {
      if (typeof params.requestId === 'string' || typeof params.requestId === 'number') {
        pendingFrames.delete(params.requestId);
      }

      approvals.resolved(params.requestId);
      userInputs.resolved(params.requestId);
    }

    if (frame.method === CodexMethod.ThreadNameUpdated) {
      monitor.setSessionTitle(
        session.id,
        typeof params.threadName === 'string' ? params.threadName : undefined,
      );
    }

    if (
      [CodexMethod.ItemStarted, CodexMethod.ItemCompleted].some(
        (candidateValue) => candidateValue === (frame.method ?? ''),
      ) &&
      typeof params.turnId === 'string'
    ) {
      publishItem(params.item, params.turnId);
    }

    if (
      frame.method === CodexMethod.ItemAgentMessageDelta &&
      typeof params.turnId === 'string' &&
      typeof params.itemId === 'string' &&
      typeof params.delta === 'string'
    ) {
      const id = `${params.turnId}:${params.itemId}`;
      const text = (liveText.get(id) ?? '') + params.delta;

      liveText.set(id, text);

      if (liveText.size > 500) {
        liveText.delete(liveText.keys().next().value!);
      }

      publishItem({ id: params.itemId, type: CodexItemType.AgentMessage, text }, params.turnId);
    }

    if (frame.method === CodexMethod.ThreadStatusChanged) {
      const status = object(params.status);

      session.status = status.type === CodexRuntimeStatus.Idle ? SessionStatus.Idle : SessionStatus.Unknown;

      if (status.type === CodexRuntimeStatus.Active) {
        session.status = SessionStatus.Running;

        if (
          Array.isArray(status.activeFlags) &&
          status.activeFlags.includes(CodexActiveFlag.WaitingOnApproval)
        ) {
          session.status = SessionStatus.WaitingPermission;
        } else if (
          Array.isArray(status.activeFlags) &&
          status.activeFlags.includes(CodexActiveFlag.WaitingOnUserInput)
        ) {
          session.status = SessionStatus.WaitingInput;
        }
      }
    }

    if (
      frame.method?.startsWith('item/') ||
      frame.method?.startsWith('turn/') ||
      frame.method === CodexMethod.ThreadStatusChanged
    ) {
      activityRevision++;
    }

    codexCurrentStep(session, frame.method, params, activeTurn);
    session.lastEventAt = Date.now();
    changed();
  };

  const request = (frame: RpcFrame) => {
    if (!hydrating) {
      return frame.method === CodexMethod.ItemToolRequestUserInput
        ? userInputs.request(frame)
        : approvals.request(frame);
    }

    if (frame.id !== undefined && pendingFrames.size < 64) {
      pendingFrames.set(frame.id, frame);
    }
  };

  const disconnected = () => {
    approvals.clear();
    userInputs.clear();
    activeTurn = null;
    monitor.invalidate(connectorId);
    void adapter.close();
  };

  const adapter = new SourceAdapter(
    {
      connectorId,
      kind: options.kind,
      transport: ConnectorTransport.AppServer,
      sourceVersion: 'local-codex',
      capabilities: session.capabilities,
      state: IntegrationState.Ready,
      reason: null,
    },
    {
      prompt: async (_binding, text, attachments = [], delivery) => {
        if (!closed && session.status === SessionStatus.Running && delivery === PromptDelivery.Immediate) {
          const expectedTurnId = activeTurn;

          if (!expectedTurnId) {
            throw new CodedError(ErrorCode.NO_ACTIVE_TURN);
          }

          const result = object(
            await rpc.request(CodexMethod.TurnSteer, {
              threadId: options.threadId,
              expectedTurnId,
              input: attachments.length
                ? codexAttachmentInput(text, attachments)
                : [{ type: CodexContentType.Text, text }],
            }),
          );

          if (result.turnId !== expectedTurnId) {
            throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
          }

          return { status: CommandStatus.Dispatched };
        }

        if (closed || activeTurn || session.status !== SessionStatus.Idle) {
          throw new CodedError(ErrorCode.SESSION_NOT_IDLE);
        }

        session.status = SessionStatus.Running;
        changed();

        try {
          const result = object(
            await rpc.request(CodexMethod.TurnStart, {
              threadId: options.threadId,
              input: attachments.length
                ? codexAttachmentInput(text, attachments)
                : [{ type: CodexContentType.Text, text }],
            }),
          );

          const turn = object(result.turn);

          if (typeof turn.id !== 'string') {
            throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
          }

          if (
            ![CodexTurnStatus.Completed, CodexTurnStatus.Failed, CodexTurnStatus.Interrupted].some(
              (candidateValue) => candidateValue === String(turn.status),
            ) &&
            monitor.session(session.id)?.status !== SessionStatus.Idle
          ) {
            activeTurn = turn.id;
          }

          return { status: CommandStatus.Dispatched };
        } catch (error) {
          session.status = SessionStatus.Unknown;
          changed();
          throw error;
        }
      },
      interrupt: async () => {
        if (!activeTurn) {
          throw new CodedError(ErrorCode.NO_ACTIVE_TURN);
        }

        await rpc.request(CodexMethod.TurnInterrupt, { threadId: options.threadId, turnId: activeTurn });

        return { status: CommandStatus.Dispatched };
      },
    },
  );

  adapter.bind(binding);
  adapters.register(adapter);
  monitor.addDesktop(session, binding);
  rpc.on(RuntimeEvent.Notification, notification);
  rpc.on(RuntimeEvent.Request, request);
  rpc.on(RuntimeEvent.Disconnected, disconnected);

  const modelReader =
    options.kind === TargetKind.CodexCli
      ? new CodexModelReader(metadata.path, options.threadId, deps.codexHome)
      : undefined;

  let modelTimer: ReturnType<typeof setInterval> | undefined;

  const close = () => {
    if (closed) {
      return;
    }

    closed = true;
    clearInterval(modelTimer);
    queuedMedia.length = 0;
    queuedBytes = 0;
    sourceFingerprints.clear();
    approvals.clear();
    userInputs.clear();
    rpc.off(RuntimeEvent.Notification, notification);
    rpc.off(RuntimeEvent.Request, request);
    rpc.off(RuntimeEvent.Disconnected, disconnected);
    monitor.invalidate(connectorId);
    void adapter.close();
  };

  try {
    const initialModelRevision = modelRevision;
    const initialModel = await modelReader?.read();
    const resumeRevision = lifecycleRevision;

    const resumeResponse = object(
      await rpc.request(CodexMethod.ThreadResume, { threadId: options.threadId, excludeTurns: true }),
    );

    const resumed = object(resumeResponse.thread);

    if (resumed.id !== options.threadId) {
      throw new CodedError(DaemonErrorCode.CODEX_THREAD_MISMATCH);
    }

    if (!closed && modelRevision === initialModelRevision) {
      monitor.setSessionModel(session.id, resumeResponse.model ?? initialModel);
    }

    if (modelReader) {
      modelTimer = setInterval(() => {
        const readRevision = modelRevision;

        void modelReader.read().then((model) => {
          if (!closed && model && modelRevision === readRevision) {
            monitor.setSessionModel(session.id, model);
          }
        });
      }, 1500);

      modelTimer.unref();
    }

    for (const turn of Array.isArray(resumed.turns) ? resumed.turns : []) {
      const data = object(turn);

      if (
        lifecycleRevision === resumeRevision &&
        data.status === CodexTurnStatus.InProgress &&
        typeof data.id === 'string' &&
        !completedTurns.has(data.id)
      ) {
        activeTurn = data.id;
      }
    }

    if (session.status === SessionStatus.Running && !activeTurn) {
      const turnRevision = lifecycleRevision;

      const page = object(
        await rpc.request(CodexMethod.ThreadTurnsList, {
          threadId: options.threadId,
          limit: 1,
          sortDirection: CodexSortDirection.Desc,
          itemsView: CodexItemsView.NotLoaded,
        }),
      );

      const current = Array.isArray(page.data) ? object(page.data[0]) : {};

      if (
        lifecycleRevision === turnRevision &&
        current.status === CodexTurnStatus.InProgress &&
        typeof current.id === 'string' &&
        !completedTurns.has(current.id)
      ) {
        activeTurn = current.id;
      }
    }

    const initialActivityRevision = activityRevision;

    let cursor: string | null = null,
      remaining = 500;

    const storedEntries: unknown[] = [];

    try {
      do {
        const page = object(
          await rpc.request(CodexMethod.ThreadItemsList, {
            threadId: options.threadId,
            limit: Math.min(100, remaining),
            sortDirection: CodexSortDirection.Desc,
            ...(cursor ? { cursor } : {}),
          }),
        );

        const entries = Array.isArray(page.data) ? page.data : [];

        storedEntries.push(...entries);
        remaining -= entries.length;
        cursor = typeof page.nextCursor === 'string' ? page.nextCursor : null;

        if (!entries.length) {
          break;
        }
      } while (cursor && remaining > 0);

      const required = new Set(
        storedEntries
          .map((entry) => object(entry).turnId)
          .filter((id): id is string => typeof id === 'string'),
      );

      const times = await historyTurnTimes(
        rpc,
        options.threadId,
        [
          ...(Array.isArray(metadata.turns) ? metadata.turns : []),
          ...(Array.isArray(resumed.turns) ? resumed.turns : []),
        ],
        required,
      );

      for (const entry of storedEntries.reverse()) {
        const value = object(entry);

        if (
          activityRevision === initialActivityRevision &&
          object(value.item).status === CodexItemStatus.InProgress
        ) {
          codexCurrentStep(session, CodexMethod.ItemStarted, value, activeTurn);
        }

        if (typeof value.turnId === 'string') {
          await publishItem(
            value.item,
            value.turnId,
            true,
            messageTime(value.occurredAt) || times.get(value.turnId) || 0,
          );
        }
      }
    } catch {
      const historyRevision = lifecycleRevision;

      const history = object(
        object(await rpc.request(CodexMethod.ThreadRead, { threadId: options.threadId, includeTurns: true }))
          .thread,
      );

      if (history.id !== options.threadId) {
        throw new CodedError(DaemonErrorCode.CODEX_THREAD_MISMATCH);
      }

      for (const raw of (Array.isArray(history.turns) ? history.turns : []).slice(-100)) {
        const turn = object(raw);

        if (typeof turn.id !== 'string') {
          continue;
        }

        if (
          lifecycleRevision === historyRevision &&
          turn.status === CodexTurnStatus.InProgress &&
          !completedTurns.has(turn.id)
        ) {
          activeTurn = turn.id;
        }

        for (const item of (Array.isArray(turn.items) ? turn.items : []).slice(-500)) {
          if (
            activityRevision === initialActivityRevision &&
            object(item).status === CodexItemStatus.InProgress
          ) {
            codexCurrentStep(session, CodexMethod.ItemStarted, { turnId: turn.id, item }, activeTurn);
          }

          await publishItem(item, turn.id, true, turnTime(turn));
        }
      }
    }

    await mediaQueue;
    hydrating = false;

    for (const frame of rpc.pendingRequests?.() ?? []) {
      if (frame.id !== undefined) {
        pendingFrames.set(frame.id, frame);
      }
    }

    for (const frame of pendingFrames.values()) {
      if (frame.method === CodexMethod.ItemToolRequestUserInput) {
        userInputs.request(frame);
      } else {
        approvals.request(frame);
      }
    }

    pendingFrames.clear();

    for (const message of deferred.values()) {
      monitor.publish(session.id, EventType.Message, message);
    }

    deferred.clear();
    changed();

    return { session, close };
  } catch (error) {
    close();
    throw error;
  }
}
