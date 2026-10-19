import {
  type AppSnapshot,
  BindingState,
  CodedError,
  ConnectorId,
  ConnectorTransport,
  DeviceStatus,
  ErrorCode,
  type EventEnvelope,
  EventType,
  historySchema,
  IntegrationState,
  NativeRestartState,
  noCapabilities,
  type Session,
  sessionSchema,
  SessionStatus,
  StatusConfidence,
  SubagentStatus,
  type Target,
  TargetKind,
} from '@protocol';
import { ClaudeHookEvent } from '../domain/claude.js';
import { RuntimeEvent, ModelOrigin } from '../domain/runtime.js';
import { boundSnapshotChanges } from '../codex/binding/file-changes.js';
import { currentToolStep, clearCurrentStep } from './activity/current-step.js';
import { boundSubagentSnapshots } from './activity/subagents.js';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { SourceAdapter, type Binding, type AdapterRegistry } from '../adapters/registry.js';
import { type UserInputBroker } from '../commands/user-input-broker.js';
import { type PermissionBroker } from '../commands/permission-broker.js';
import { type LocalStore } from './store.js';

export const hookSchema = z.object({
  hook_event_name: z.string().min(1).max(128),
  session_id: z.string().min(1).max(512),
  transcript_path: z.string().max(4096).optional(),
  source: z.string().max(128).optional(),
  model: sessionSchema.shape.model.optional(),
  cwd: sessionSchema.shape.cwd.optional(),
  agent_id: z.string().min(1).max(512).optional(),
  agent_type: z.string().max(512).optional(),
  tool_use_id: z.string().min(1).max(512).optional(),
  tool_name: z.string().max(512).optional(),
  tool_input: z.unknown().optional(),
});
export type HookEnvelope = z.infer<typeof hookSchema>;
interface Options {
  deviceId: string;
  store: LocalStore;
  adapters: AdapterRegistry;
  permissions: PermissionBroker;
  userInputs?: UserInputBroker;
  allowSessionCreation?: boolean;
}
export class Monitor extends EventEmitter {
  private sessions = new Map<string, Session>();
  private bindings = new Map<string, Binding>();
  private restored = new Set<string>();
  private restarting = new Set<string>();
  private retiredNative = new Set<string>();
  private nativeModels = new Set<string>();
  private nativeModelRevisions = new Map<string, number>();
  private transcriptModels = new Map<string, { generation: string; model: string | undefined }>();
  private terminal: AppSnapshot['terminal'] = null;
  selectedId: string | null = null;
  constructor(private options: Options) {
    super();

    for (const { session: saved } of this.options.store.nativeSessions().slice(0, 10)) {
      const adapter = this.options.adapters.get(saved.target.connectorId);

      if (
        adapter?.descriptor().transport !== ConnectorTransport.Hooks ||
        adapter.descriptor().kind !== TargetKind.ClaudeCodeCli
      ) {
        continue;
      }

      const session: Session = {
        ...saved,
        nativeRestartState: undefined,
        generation: randomUUID(),
        currentActivity: undefined,
        subagents: saved.subagents?.map((agent) =>
          [SubagentStatus.Queued, SubagentStatus.Running, SubagentStatus.WaitingInput].some(
            (candidateValue) => candidateValue === agent.status,
          )
            ? { ...agent, status: SubagentStatus.Unknown }
            : agent,
        ),
        binding: BindingState.Unverified,
        status: saved.status === SessionStatus.Ended ? SessionStatus.Ended : SessionStatus.Unknown,
        integrationState: IntegrationState.NeedsRestart,
        statusConfidence: StatusConfidence.Inferred,
        capabilities: { ...noCapabilities, observe: true, history: true },
      };

      this.sessions.set(session.id, session);
      this.restored.add(session.id);
    }
  }
  ingestHook(raw: HookEnvelope, connectorId: string, targetOverride?: Target): EventEnvelope[] {
    const hook = hookSchema.parse(raw),
      adapter = this.options.adapters.get(connectorId);

    if (!adapter) {
      throw new CodedError(ErrorCode.NOT_FOUND);
    }

    const descriptor = adapter.descriptor();

    if (connectorId === ConnectorId.Native && this.retiredNative.has(hook.session_id)) {
      if (hook.hook_event_name !== ClaudeHookEvent.SessionStart) {
        return [];
      }

      this.retiredNative.delete(hook.session_id);
    }

    const target: Target =
      targetOverride ??
      (descriptor.kind === TargetKind.ClaudeCodeDesktop
        ? {
            kind: TargetKind.ClaudeCodeDesktop,
            deviceId: this.options.deviceId,
            connectorId,
            claudeSessionId: hook.session_id,
          }
        : {
            kind: TargetKind.ClaudeCodeCli,
            deviceId: this.options.deviceId,
            connectorId,
            claudeSessionId: hook.session_id,
          });

    const key = JSON.stringify(target);
    let session = [...this.sessions.values()].find((s) => JSON.stringify(s.target) === key);

    if (
      !session &&
      hook.hook_event_name === ClaudeHookEvent.SessionStart &&
      [ConnectorTransport.Pty, ConnectorTransport.Cmux].some(
        (candidateValue) => candidateValue === descriptor.transport,
      )
    ) {
      session = [...this.sessions.values()].find(
        (s) =>
          s.target.connectorId === ConnectorId.Native &&
          s.claudeSessionId === hook.session_id &&
          s.status === SessionStatus.Ended,
      );

      if (session) {
        const previous = this.options.adapters.get(ConnectorId.Native);

        if (previous instanceof SourceAdapter) {
          previous.unbind(session.target);
        }

        this.options.store.removeNativeSession(session.id);
        this.restarting.delete(session.id);
        this.retiredNative.add(hook.session_id);

        if (this.retiredNative.size > 100) {
          this.retiredNative.delete(this.retiredNative.values().next().value!);
        }
      }
    }

    if (!session || hook.hook_event_name === ClaudeHookEvent.SessionStart) {
      if (session) {
        this.options.permissions.cancelSession(session.id, session.generation);
        this.options.userInputs?.cancelSession(session.id, session.generation);
      }

      if (!session) {
        this.makeRoom();
      }

      const verified = hook.hook_event_name === ClaudeHookEvent.SessionStart;

      session = {
        id: session?.id ?? randomUUID(),
        target,
        ...(session?.title ? { title: session.title } : {}),
        ...(session?.model ? { model: session.model } : {}),
        ...(session?.lastMessageAt !== undefined ? { lastMessageAt: session.lastMessageAt } : {}),
        claudeSessionId: hook.session_id,
        generation: randomUUID(),
        status:
          verified &&
          [ConnectorTransport.Pty, ConnectorTransport.Cmux].some(
            (candidateValue) => candidateValue === descriptor.transport,
          )
            ? SessionStatus.Idle
            : SessionStatus.Unknown,
        binding: verified ? BindingState.Verified : BindingState.Unverified,
        lastEventAt: Date.now(),
        capabilities: {
          ...descriptor.capabilities,
          ...(!verified ? { prompt: false, interrupt: false } : {}),
        },
        integrationState: verified ? IntegrationState.Ready : IntegrationState.NeedsRestart,
        statusConfidence: StatusConfidence.Observed,
      };

      if (!verified) {
        delete session.capabilities.attachments;
      }

      this.sessions.set(session.id, session);
      const binding = { target, generation: session.generation, localProof: randomUUID() };

      this.bindings.set(session.id, binding);

      if (adapter instanceof SourceAdapter) {
        adapter.bind(binding);
      }
    }

    if (hook.cwd) {
      session.cwd = hook.cwd;
    }

    if (this.options.allowSessionCreation && session.cwd && session.binding === BindingState.Verified) {
      session.capabilities.createSession = true;
    }

    if (hook.model) {
      session.model = hook.model;
      this.nativeModels.add(session.id);
      this.nativeModelRevisions.set(session.id, this.sessionModelRevision(session.id) + 1);
    }

    if (
      hook.agent_id &&
      [ClaudeHookEvent.SubagentStart, ClaudeHookEvent.SubagentStop].some(
        (candidateValue) => candidateValue === hook.hook_event_name,
      )
    ) {
      const agents = session.subagents ?? [];
      const previous = agents.find((agent) => agent.id === hook.agent_id);

      session.subagents = [
        ...agents.filter((agent) => agent.id !== hook.agent_id),
        {
          ...previous,
          id: hook.agent_id,
          ...(hook.agent_type ? { name: hook.agent_type } : {}),
          status:
            hook.hook_event_name === ClaudeHookEvent.SubagentStart
              ? SubagentStatus.Running
              : SubagentStatus.Completed,
          updatedAt: Date.now(),
        },
      ].slice(-50);
    }

    this.restored.delete(session.id);
    session.lastEventAt = Date.now();

    const statuses: Record<string, Session['status']> = {
      [ClaudeHookEvent.UserPromptSubmit]: SessionStatus.Running,
      [ClaudeHookEvent.Stop]: SessionStatus.Idle,
      [ClaudeHookEvent.SessionEnd]: SessionStatus.Ended,
      [ClaudeHookEvent.PermissionRequest]: SessionStatus.WaitingPermission,
    };

    const status = statuses[hook.hook_event_name];

    if (status) {
      session.status = status;
    }

    if (hook.hook_event_name === ClaudeHookEvent.SessionEnd) {
      session.capabilities = { ...session.capabilities, prompt: false, interrupt: false, permission: false };
      delete session.capabilities.attachments;
      this.options.permissions.cancelSession(session.id, session.generation);
      this.options.userInputs?.cancelSession(session.id, session.generation);
    }

    if (hook.hook_event_name === ClaudeHookEvent.PreToolUse) {
      session.status = SessionStatus.Running;

      session.currentActivity = currentToolStep(
        hook.tool_use_id ?? hook.tool_name ?? 'tool',
        hook.tool_name ?? '',
      );
    } else if (
      [ClaudeHookEvent.PostToolUse, ClaudeHookEvent.PostToolUseFailure].some(
        (candidateValue) => candidateValue === hook.hook_event_name,
      )
    ) {
      clearCurrentStep(session, hook.tool_use_id ?? hook.tool_name);
    } else if (
      [
        ClaudeHookEvent.UserPromptSubmit,
        ClaudeHookEvent.Stop,
        ClaudeHookEvent.SessionEnd,
        ClaudeHookEvent.PermissionRequest,
      ].some((candidateValue) => candidateValue === hook.hook_event_name)
    ) {
      clearCurrentStep(session);
    }

    const eventTypes = {
      [ClaudeHookEvent.Stop]: EventType.TurnEnd,
      [ClaudeHookEvent.SessionEnd]: EventType.SessionEnd,
      [ClaudeHookEvent.PermissionRequest]: EventType.Permission,
      [ClaudeHookEvent.PreToolUse]: EventType.Tool,
      [ClaudeHookEvent.PostToolUse]: EventType.Tool,
    } as const;

    const type = eventTypes[hook.hook_event_name as keyof typeof eventTypes] ?? EventType.Status;

    this.persistNative(session, hook.transcript_path);

    const event = this.publish(session.id, type, {
      status: session.status,
      ...(hook.tool_name ? { toolName: hook.tool_name } : {}),
    });

    this.emit(RuntimeEvent.Snapshot);

    return [event];
  }
  private persistNative(session: Session, transcriptPath?: string) {
    if (
      session.target.connectorId === ConnectorId.Native &&
      session.target.kind === TargetKind.ClaudeCodeCli &&
      this.options.adapters.get(ConnectorId.Native)?.descriptor().transport === ConnectorTransport.Hooks
    ) {
      this.options.store.saveNativeSession(session, transcriptPath);
    } else if (
      [ConnectorTransport.Pty, ConnectorTransport.Cmux].some(
        (candidateValue) =>
          candidateValue ===
          (this.options.adapters.get(session.target.connectorId)?.descriptor().transport ?? ''),
      )
    ) {
      this.options.store.saveManagedSession(session, transcriptPath);
    }
  }
  managedRegistration(
    connectorId: string,
    cmux?: { windowId: string; workspaceId: string; surfaceId: string },
  ) {
    const registration = this.options.store.managedRegistration(connectorId);

    if (!registration) {
      return;
    }

    const target = registration.session.target;

    if (
      cmux
        ? target.kind !== TargetKind.Cmux ||
          target.windowId !== cmux.windowId ||
          target.workspaceId !== cmux.workspaceId ||
          target.surfaceId !== cmux.surfaceId
        : target.kind !== TargetKind.ClaudeCodeCli
    ) {
      return;
    }

    return registration;
  }
  restoreManaged(saved: Session) {
    const adapter = this.options.adapters.resolve(saved.target);

    if (
      !(adapter instanceof SourceAdapter) ||
      ![ConnectorTransport.Pty, ConnectorTransport.Cmux].some(
        (candidateValue) => candidateValue === adapter.descriptor().transport,
      ) ||
      saved.status === SessionStatus.Ended
    ) {
      throw new CodedError(ErrorCode.STALE_SESSION);
    }

    if (!this.sessions.has(saved.id)) {
      this.makeRoom();
    }

    const session: Session = {
      ...saved,
      currentActivity: undefined,
      generation: randomUUID(),
      binding: BindingState.Verified,
      integrationState: IntegrationState.Ready,
      statusConfidence: StatusConfidence.Inferred,
      capabilities: adapter.descriptor().capabilities,
    };

    const binding = { target: session.target, generation: session.generation, localProof: randomUUID() };

    this.sessions.set(session.id, session);
    this.bindings.set(session.id, binding);
    adapter.bind(binding);
    this.persistNative(session);
    this.emit(RuntimeEvent.Snapshot);
  }
  markNativeStopped(id: string, generation: string) {
    const session = this.sessions.get(id);

    if (!session || session.generation !== generation || session.target.connectorId !== ConnectorId.Native) {
      throw new CodedError(ErrorCode.STALE_SESSION);
    }

    session.status = SessionStatus.Ended;
    clearCurrentStep(session);
    session.capabilities = { ...session.capabilities, restartSession: false };
    this.restarting.add(id);
    this.emit(RuntimeEvent.Snapshot);
  }
  releaseNativeRestart(id: string) {
    this.restarting.delete(id);
  }
  setNativeRestartState(id: string, generation: string, state: NonNullable<Session['nativeRestartState']>) {
    const session = this.sessions.get(id);
    const available = state === NativeRestartState.Available;

    if (
      !session ||
      session.generation !== generation ||
      session.target.connectorId !== ConnectorId.Native ||
      (session.capabilities.restartSession === available && session.nativeRestartState === state)
    ) {
      return;
    }

    session.capabilities.restartSession = available;
    session.nativeRestartState = state;
    this.emit(RuntimeEvent.Snapshot);
  }
  canCreateSession() {
    return (
      this.sessions.size < 10 ||
      [...this.sessions.values()].some(
        (session) =>
          session.status === SessionStatus.Ended ||
          session.integrationState === IntegrationState.Disconnected ||
          (this.restored.has(session.id) &&
            session.binding === BindingState.Unverified &&
            session.target.connectorId === ConnectorId.Native),
      )
    );
  }
  private makeRoom() {
    if (this.sessions.size < 10) {
      return;
    }

    const oldest = (candidates: Session[]) => candidates.sort((a, b) => a.lastEventAt - b.lastEventAt)[0];
    const sessions = [...this.sessions.values()].filter((session) => !this.restarting.has(session.id));

    const retired =
      oldest(
        sessions.filter(
          (s) => s.status === SessionStatus.Ended || s.integrationState === IntegrationState.Disconnected,
        ),
      ) ??
      oldest(
        sessions.filter(
          (s) =>
            this.restored.has(s.id) &&
            s.binding === BindingState.Unverified &&
            s.target.connectorId === ConnectorId.Native &&
            s.target.kind === TargetKind.ClaudeCodeCli,
        ),
      );

    if (!retired) {
      throw new CodedError(ErrorCode.SESSION_QUOTA);
    }

    this.options.permissions.cancelSession(retired.id, retired.generation);
    this.options.userInputs?.cancelSession(retired.id, retired.generation);
    const adapter = this.options.adapters.get(retired.target.connectorId);

    if (adapter instanceof SourceAdapter) {
      adapter.unbind(retired.target);
    }

    this.sessions.delete(retired.id);
    this.nativeModels.delete(retired.id);
    this.nativeModelRevisions.delete(retired.id);
    this.transcriptModels.delete(retired.id);
    this.restored.delete(retired.id);
    this.options.store.removeNativeSession(retired.id);
    this.bindings.delete(retired.id);

    if (this.selectedId === retired.id) {
      this.selectedId = null;
      this.terminal = null;
    }
  }
  addDesktop(session: Session, binding: Binding) {
    const previous = this.sessions.get(session.id);

    if (previous && previous.generation !== session.generation) {
      this.options.userInputs?.cancelSession(previous.id, previous.generation);
    }

    if (!this.sessions.has(session.id)) {
      this.makeRoom();
    }

    if (this.options.allowSessionCreation && session.cwd && session.binding === BindingState.Verified) {
      session.capabilities.createSession = true;
    }

    this.sessions.set(session.id, session);
    this.bindings.set(session.id, binding);
    this.emit(RuntimeEvent.Snapshot);
  }
  session(id: string) {
    return this.sessions.get(id);
  }
  applyDesktopRead(
    id: string,
    read: { status: Session['status']; canPrompt: boolean; canInterrupt: boolean },
  ) {
    const session = this.sessions.get(id);

    if (!session) {
      return false;
    }

    session.status = read.status;
    session.lastEventAt = Date.now();
    session.capabilities.prompt = read.canPrompt;
    session.capabilities.interrupt = read.canInterrupt;

    return true;
  }
  setSessionActivity(id: string, generation: string, time: number) {
    const session = this.sessions.get(id);

    if (
      !session ||
      session.generation !== generation ||
      !Number.isFinite(time) ||
      time <= 0 ||
      time <= (session.lastMessageAt ?? 0)
    ) {
      return;
    }

    session.lastMessageAt = time;
    this.persistNative(session);
    this.emit(RuntimeEvent.Snapshot);
  }
  setSessionTitle(id: string, title: string | undefined): boolean {
    const session = this.sessions.get(id);
    const parsed = sessionSchema.shape.title.safeParse(title);

    if (!session || !parsed.success || session.title === parsed.data) {
      return false;
    }

    if (parsed.data === undefined) {
      delete session.title;
    } else {
      session.title = parsed.data;
    }

    this.persistNative(session);
    this.emit(RuntimeEvent.Snapshot);

    return true;
  }
  setSubagents(id: string, agents: Session['subagents']) {
    const session = this.sessions.get(id);
    const parsed = sessionSchema.shape.subagents.safeParse(agents);

    if (!session || !parsed.success || JSON.stringify(session.subagents) === JSON.stringify(parsed.data)) {
      return;
    }

    session.subagents = parsed.data;
    this.persistNative(session);
    this.emit(RuntimeEvent.Snapshot);
  }
  sessionModelRevision(id: string): number {
    return this.nativeModelRevisions.get(id) ?? 0;
  }
  setSessionModel(
    id: string,
    model: unknown,
    origin: typeof ModelOrigin.Native | typeof ModelOrigin.Transcript = ModelOrigin.Native,
    expectedNativeRevision?: number,
  ): boolean {
    const session = this.sessions.get(id);
    const parsed = sessionSchema.shape.model.safeParse(model);

    if (!session || !parsed.success) {
      return false;
    }

    if (origin === ModelOrigin.Transcript) {
      const previous = this.transcriptModels.get(id);
      const sameGeneration = previous?.generation === session.generation;

      this.transcriptModels.set(id, { generation: session.generation, model: parsed.data });

      if (expectedNativeRevision !== undefined && this.sessionModelRevision(id) !== expectedNativeRevision) {
        return false;
      }

      if (
        (!sameGeneration && this.nativeModels.has(id)) ||
        (sameGeneration && previous.model === parsed.data)
      ) {
        return false;
      }

      this.nativeModels.delete(id);
    } else {
      this.nativeModels.add(id);
      this.nativeModelRevisions.set(id, this.sessionModelRevision(id) + 1);
    }

    if (session.model === parsed.data) {
      return false;
    }

    if (parsed.data === undefined) {
      delete session.model;
    } else {
      session.model = parsed.data;
    }

    this.persistNative(session);
    this.emit(RuntimeEvent.Snapshot);

    return true;
  }
  binding(id: string) {
    return this.bindings.get(id);
  }
  findClaude(connectorId: string, claudeSessionId: string) {
    return [...this.sessions.values()].find(
      (s) => s.target.connectorId === connectorId && s.claudeSessionId === claudeSessionId,
    );
  }
  invalidate(connectorId: string) {
    for (const session of this.sessions.values()) {
      if (session.target.connectorId === connectorId) {
        session.subagents = session.subagents?.map((agent) =>
          [SubagentStatus.Queued, SubagentStatus.Running, SubagentStatus.WaitingInput].some(
            (candidateValue) => candidateValue === agent.status,
          )
            ? { ...agent, status: SubagentStatus.Unknown }
            : agent,
        );

        clearCurrentStep(session);
        session.binding = BindingState.Unverified;
        session.integrationState = IntegrationState.Disconnected;
        session.capabilities = { ...noCapabilities };
        this.options.permissions.cancelSession(session.id, session.generation);
        this.options.userInputs?.cancelSession(session.id, session.generation);
        this.publish(session.id, EventType.BindingLost, {});
      }
    }

    this.emit(RuntimeEvent.Snapshot);
  }
  select(id: string | null) {
    if (id && !this.sessions.has(id)) {
      throw new CodedError(ErrorCode.NOT_FOUND);
    }

    this.selectedId = id;
    this.terminal = null;
    this.emit(RuntimeEvent.Snapshot);
  }
  setTerminal(value: AppSnapshot['terminal']) {
    if (value && value.sessionId !== this.selectedId) {
      return;
    }

    if (JSON.stringify(value) === JSON.stringify(this.terminal)) {
      return;
    }

    this.terminal = value;
    this.emit(RuntimeEvent.Snapshot);
  }
  publish(sessionId: string | null, type: string, payload: unknown, occurredAt = Date.now()) {
    const message = type === EventType.Message ? historySchema.safeParse(payload) : null;
    const session = sessionId ? this.sessions.get(sessionId) : undefined;

    if (session && message?.success) {
      session.lastMessageAt = Math.max(session.lastMessageAt ?? 0, message.data.occurredAt);
      this.persistNative(session);
    }

    const event = this.options.store.append({ sessionId, type, payload, occurredAt });

    this.emit(RuntimeEvent.Event, event);

    return event;
  }
  snapshot(): AppSnapshot {
    return structuredClone(
      boundSnapshotChanges({
        sessions: boundSubagentSnapshots([...this.sessions.values()]),
        deviceStatus: DeviceStatus.Online,
        cursor: this.options.store.cursor(),
        permissions: this.options.permissions.pending(),
        userInputs: this.options.userInputs?.pending() ?? [],
        terminal: this.terminal,
      }),
    );
  }
}
